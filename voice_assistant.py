import os
import sys
import asyncio
import tempfile
import pygame
import speech_recognition as sr
import edge_tts

# ضبط الترميز للغة العربية في التيرمنال (مع التوافق مع Jupyter Notebook)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# =====================================================================
# أفضل الأصوات العربية العصبية في Edge-TTS:
# - "ar-EG-SalmaNeural"  (أنثى - مصري طبيعي جداً لخدمة العملاء)
# - "ar-EG-ShakirNeural" (ذكر - مصري طبيعي)
# - "ar-SA-HamedNeural"  (ذكر - سعودي / فصحى)
# - "ar-SA-ZariyahNeural" (أنثى - سعودي / فصحى)
# =====================================================================
DEFAULT_VOICE = "ar-EG-SalmaNeural"


async def _generate_audio_file(text: str, output_path: str, voice: str):
    """توليد ملف صوتي باستخدام Microsoft Edge TTS"""
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)


def _run_coroutine(coro):
    """تشغيل المهام غير المتزامنة بأمان تام حتى لو كنا داخل Jupyter Notebook Event Loop"""
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, coro).result()


def speak(text: str, voice: str = DEFAULT_VOICE):
    """
    تحويل النص العربي إلى صوت ونطقه فوراً عبر السماعات.
    يدعم التشغيل داخل Jupyter Notebook والتيرمنال بكفاءة عالية.
    """
    if not text or not text.strip():
        return

    print(f"\n🔊 المساعد ينطق: {text}")
    temp_path = None
    try:
        # إنشاء ملف mp3 مؤقت
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as temp_file:
            temp_path = temp_file.name

        # توليد الصوت من Edge-TTS بأمان
        _run_coroutine(_generate_audio_file(text, temp_path, voice))

        # قراءة البيانات الصوتية
        with open(temp_path, "rb") as f:
            audio_bytes = f.read()

        # 1. إذا كنا داخل بيئة Jupyter Notebook: عرض مشغل الصوت وتشغيله تلقائياً
        try:
            from IPython.display import Audio, display
            display(Audio(data=audio_bytes, autoplay=True))
        except Exception:
            pass

        # 2. تشغيل الصوت عبر مشغل النظام (pygame)
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
            pygame.mixer.music.load(temp_path)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                pygame.time.Clock().tick(10)
            pygame.mixer.music.unload()
        except Exception:
            pass

    except Exception as e:
        print(f"⚠️ خطأ أثناء توليد/تشغيل الصوت: {e}")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass


def listen(language: str = "ar-EG") -> str:
    """
    الاستماع لصوت المستخدم عبر الميكروفون وتحويله إلى نص عربي.
    مثال:
        user_text = listen()
    """
    recognizer = sr.Recognizer()
    recognizer.energy_threshold = 300
    recognizer.dynamic_energy_threshold = True

    try:
        with sr.Microphone() as source:
            print("\n🎤 الاستماع جارٍ... تحدث الآن باللغة العربية:")
            recognizer.adjust_for_ambient_noise(source, duration=0.6)
            audio = recognizer.listen(source, timeout=8, phrase_time_limit=15)
            print("⏳ جاري التعرف على الصوت...")

            text = recognizer.recognize_google(audio, language=language)
            print(f"👤 تم التقاط الصوت: {text}")
            return text.strip()

    except sr.WaitTimeoutError:
        print("⏱️ انتهت المهلة دون التقاط صوت.")
        return ""
    except sr.UnknownValueError:
        print("❓ لم أتمكن من فهم الصوت بوضوح.")
        return ""
    except Exception as e:
        print(f"⚠️ تعذر تشغيل الميكروفون ({e}). يمكنك كتابة استفسارك بدلاً من ذلك.")
        try:
            return input("⌨️ اكتب هنا: ").strip()
        except:
            return ""


if __name__ == "__main__":
    # تجربة سريعة عند تشغيل الملف بمفرده
    print("=" * 50)
    print("🎙️ تجربة وحدة الصوت (Voice Module)")
    print("=" * 50)
    speak("أهلاً بك! تم تشغيل وحدة الصوت بنجاح.")
    user_input = listen()
    if user_input:
        speak(f"سمعتك تقول: {user_input}")
