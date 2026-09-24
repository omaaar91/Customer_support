import os
import sys
import base64
import asyncio
import tempfile
import warnings
import pandas as pd
from dotenv import load_dotenv
from pypdf import PdfReader
from langchain_groq import ChatGroq
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings
from chromadb.utils import embedding_functions
from langchain_classic.memory import ConversationSummaryBufferMemory
import edge_tts
import json
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import uvicorn

# ضبط الترميز والتحذيرات
sys.stdout.reconfigure(encoding="utf-8")
load_dotenv(override=True)
warnings.filterwarnings("ignore")

# =====================================================================
# 1. إعداد محرك الذكاء الاصطناعي (LLM) وقواعد البيانات (PDF + Excel)
# =====================================================================
LLM_MODEL = "qwen/qwen3.8-27b"
llm = ChatGroq(model=LLM_MODEL, temperature=0.2)

class ChromaDefaultEmbeddings(Embeddings):
    def __init__(self):
        self.ef = embedding_functions.DefaultEmbeddingFunction()
    def embed_documents(self, texts):
        return self.ef(texts)
    def embed_query(self, text):
        return self.ef([text])[0]

embedding_model = ChromaDefaultEmbeddings()

# أ. فهرسة ملف الـ PDF
print("⏳ جاري فهرسة دليل المتجر (customerSupport.pdf)...")
reader = PdfReader("customerSupport.pdf")
full_pdf_text = "\n".join([p.extract_text() for p in reader.pages if p.extract_text()])
splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
pdf_chunks = splitter.split_text(full_pdf_text)
pdf_docs = [Document(page_content=t, metadata={"id": i}) for i, t in enumerate(pdf_chunks)]
pdf_vector_db = Chroma.from_documents(pdf_docs, embedding=embedding_model)

# ب. قراءة مخزون هواتف الإكسل
print("⏳ جاري قراءة مخزون الهواتف (Ecommerce_Database.xlsx)...")
df = pd.read_excel("Ecommerce_Database.xlsx")
all_products_text = ""
for idx, row in df.iterrows():
    all_products_text += (
        f"- الماركة: {row['الماركة']} | الموديل: {row['الموديل']} | "
        f"المساحة: {row['المساحة (جيجابايت)']} | الرامات: {row['الرامات (جيجابايت)']} | "
        f"السعر: {row['السعر (جنيه)']} جنيه\n"
    )

# ج. إعداد الذاكرة
memory = ConversationSummaryBufferMemory(
    llm=llm,
    max_token_limit=350,
    memory_key="chat_history"
)

def ask_customer_support(user_query: str) -> str:
    """معالجة السؤال وإرجاع الإجابة الدقيقة"""
    # استخراج كلمات مفتاحية إنجليزية للـ Vector DB
    keyword_prompt = f"""Convert this user query into 3-4 English search keywords for customer service retrieval.
Query: "{user_query}"
Keywords only:"""
    keywords = llm.invoke(keyword_prompt).content.strip()

    # البحث في مقاطع الـ PDF
    policy_docs = pdf_vector_db.similarity_search(keywords, k=2)
    policy_context = "\n---\n".join([d.page_content for d in policy_docs])

    # استرجاع سياق الذاكرة
    chat_history = memory.load_memory_variables({})['chat_history']

    system_prompt = f"""أنت ممثل خدمة عملاء محترف ولطيف في متجر هواتف (ألفا فون).
أجب باللغة العربية بأسلوب راقٍ ومختصر ومناسب للنطق الصوتي (لا تطل الرد بشكل مفرط):

[سياق وتاريخ المحادثة السابقة]:
{chat_history}

[دليل وسياسات المتجر (PDF)]:
{policy_context}

[مخزون وهواتف المتجر (Excel)]:
{all_products_text}

تعليمات صارمة:
- انتبه لسياق الحديث السابق إذا كان العميل يشير لمنتج ذُكر سابقاً.
- التزم بسياسات الاسترجاع والضمان بدقة من دليل المتجر.
- اذكر أسعار ومواصفات الهواتف بدقة من قائمة المخزون، وقارن بدقة عند طلب الأرخص أو الأغلى.
- لا تؤلف معلومات من خارج البيانات المتاحة لديك.

سؤال العميل: {user_query}
رد خدمة العملاء:"""

    response = llm.invoke(system_prompt).content.strip()
    memory.save_context({"input": user_query}, {"output": response})
    return response


async def stream_customer_support(user_query: str, voice: str = "ar-EG-SalmaNeural"):
    """بث الإجابة رمزاً برمز (Streaming) وتوليد الصوت فور الانتهاء"""
    try:
        # 1. استخراج كلمات مفتاحية إنجليزية للـ Vector DB بشكل غير متزامن
        keyword_prompt = f"""Convert this user query into 3-4 English search keywords for customer service retrieval.
Query: "{user_query}"
Keywords only:"""
        kw_res = await llm.ainvoke(keyword_prompt)
        keywords = kw_res.content.strip()

        # 2. البحث في وثيقة الدعم (PDF)
        policy_docs = pdf_vector_db.similarity_search(keywords, k=2)
        policy_context = "\n---\n".join([d.page_content for d in policy_docs])

        # 3. سياق الذاكرة
        chat_history = memory.load_memory_variables({})['chat_history']

        system_prompt = f"""أنت ممثل خدمة عملاء محترف ولطيف في متجر هواتف (ألفا فون).
أجب باللغة العربية بأسلوب راقٍ ومختصر ومناسب للنطق الصوتي (لا تطل الرد بشكل مفرط):

[سياق وتاريخ المحادثة السابقة]:
{chat_history}

[دليل وسياسات المتجر (PDF)]:
{policy_context}

[مخزون وهواتف المتجر (Excel)]:
{all_products_text}

تعليمات صارمة:
- انتبه لسياق الحديث السابق إذا كان العميل يشير لمنتج ذُكر سابقاً.
- التزم بسياسات الاسترجاع والضمان بدقة من دليل المتجر.
- اذكر أسعار ومواصفات الهواتف بدقة من قائمة المخزون، وقارن بدقة عند طلب الأرخص أو الأغلى.
- لا تؤلف معلومات من خارج البيانات المتاحة لديك.

سؤال العميل: {user_query}
رد خدمة العملاء:"""

        full_reply = ""
        # 4. بث النص كلمة بكلمة فور إنتاجها من الـ LLM
        async for chunk in llm.astream(system_prompt):
            token = chunk.content
            if token:
                full_reply += token
                yield f"data: {json.dumps({'type': 'token', 'content': token}, ensure_ascii=False)}\n\n"

        # 5. حفظ الرد في الذاكرة
        memory.save_context({"input": user_query}, {"output": full_reply})

        # 6. توليد الصوت عبر Edge-TTS وإرسال الصوت النهائي
        audio_b64 = await text_to_speech_base64(full_reply, voice=voice)
        yield f"data: {json.dumps({'type': 'done', 'reply': full_reply, 'audio_base64': audio_b64}, ensure_ascii=False)}\n\n"

    except Exception as e:
        print(f"Error in stream_customer_support: {e}")
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"


# =====================================================================
# 2. توليد الصوت عبر Edge-TTS بسرعة فائقة
# =====================================================================
async def text_to_speech_base64(text: str, voice: str = "ar-EG-SalmaNeural") -> str:
    """تحويل النص إلى صوت وإرجاعه كـ Base64 لتشغيله في المتصفح فوراً بدون كتابة ملفات"""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as temp_file:
        temp_path = temp_file.name

    try:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(temp_path)
        with open(temp_path, "rb") as f:
            audio_bytes = f.read()
        return base64.b64encode(audio_bytes).decode("utf-8")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass


# =====================================================================
# 3. تطبيق FastAPI
# =====================================================================
app = FastAPI(title="Alpha Phone Voice Assistant")

# تقديم الملفات الثابتة (HTML, CSS, JS)
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/static", StaticFiles(directory=static_dir), name="static")


class ChatRequest(BaseModel):
    message: str
    voice: str = "ar-EG-SalmaNeural"
    stream: bool = True


@app.get("/")
def get_index():
    return FileResponse(os.path.join(static_dir, "index.html"))


@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    query = req.message.strip()
    if not query:
        raise HTTPException(status_code=400, detail="الرسالة فارغة")

    if req.stream:
        return StreamingResponse(
            stream_customer_support(query, voice=req.voice),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )
    else:
        try:
            # 1. توليد إجابة الـ LLM
            reply_text = ask_customer_support(query)

            # 2. توليد الصوت فائق السرعة عبر Edge-TTS
            audio_b64 = await text_to_speech_base64(reply_text, voice=req.voice)

            return {
                "status": "success",
                "reply": reply_text,
                "audio_base64": audio_b64
            }
        except Exception as e:
            print(f"Error in chat endpoint: {e}")
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/reset")
def reset_memory():
    global memory
    memory = ConversationSummaryBufferMemory(
        llm=llm,
        max_token_limit=350,
        memory_key="chat_history"
    )
    return {"status": "memory reset"}


if __name__ == "__main__":
    print("\n" + "="*60)
    print("🚀 جاري تشغيل خادم المساعد الصوتي على: http://localhost:8000")
    print("="*60)
    uvicorn.run(app, host="127.0.0.1", port=8000)
