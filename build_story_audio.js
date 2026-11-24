const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUDIO_DIR = path.join(__dirname, 'simulator', 'audio');
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// All Interactive Story Chunks
const audioTasks = [
    {
        filename: 'welcome.mp3',
        text: 'مرحباً يا بطل! أنا روبوتك الذكي، المس رأسي لنبدأ مغامرتنا السحرية!'
    },
    {
        filename: 'space_1.mp3',
        text: 'مرحباً يا صديقي البطل! أنا روبوتك الذكي، هل أنت مستعد لرحلة مذهلة في الفضاء الخارجي؟'
    },
    {
        filename: 'space_2.mp3',
        text: 'روووعة! لقد انطلقنا بسرعة الضوء إلى الفضاء! انظر إلى النجوم والكواكب المتلألئة حولنا...'
    },
    {
        filename: 'space_3.mp3',
        text: 'أرى كوكباً سحرياً جديداً ينتظر اسماً! قل لي بصوتك عبر الميكروفون: ما هو اللون أو الاسم الذي تريده لهذا الكوكب؟'
    },
    {
        filename: 'space_4.mp3',
        text: 'يا له من اختيار ساحر وذوق رفيع! لقد أصبح الكوكب جميلاً ومضيئاً بفضلك يا بطل!'
    },
    {
        filename: 'space_5.mp3',
        text: 'عدنا بسلام إلى الأرض! لقد كنت مستكشفاً شجاعاً وذكياً اليوم. أحبك كثيراً وإلى اللقاء في مغامرة قادمة!'
    },
    {
        filename: 'animals_1.mp3',
        text: 'أهلاً بك في الغابة السحرية! اسمع جيداً... هناك صوت خطوات لطيفة تقترب منا بين الأشجار'
    },
    {
        filename: 'animals_2.mp3',
        text: 'إنه الأسد سيمبا اللطيف! يبتسم لك ويهديك زهرة ذهبية فواحة'
    },
    {
        filename: 'animals_3.mp3',
        text: 'ما هو حيوانك المفضل في الغابة؟ قل لي اسمه بصوتك عبر الميكروفون!'
    },
    {
        filename: 'animals_4.mp3',
        text: 'حيوان رائع ومحبوب جداً مثلك تماماً! كل حيوانات الغابة سعيدة بوجودك بيننا اليوم'
    }
];

async function fetchAudio(text) {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=ar&client=tw-ob&q=' + encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
}

async function buildAllAudio() {
    console.log('Generating high-quality cartoon child-robot audio files...');
    const tempRaw = path.join(__dirname, 'temp_raw.mp3');

    for (const task of audioTasks) {
        const targetPath = path.join(AUDIO_DIR, task.filename);
        console.log(`Processing: ${task.filename}...`);

        try {
            const rawBuffer = await fetchAudio(task.text);
            fs.writeFileSync(tempRaw, rawBuffer);

            // Apply FFmpeg filters:
            // 1. asetrate slightly increases speed and pitch into a cute cartoon voice
            // 2. atempo moderates the speed so it speaks clearly and calmly for a child
            // 3. volume boost
            const cmd = `ffmpeg -y -i "${tempRaw}" -af "asetrate=24000*1.18,aresample=24000,atempo=0.92,volume=1.25" "${targetPath}"`;
            execSync(cmd, { stdio: 'pipe' });

            console.log(`  -> Saved: ${task.filename} (${fs.statSync(targetPath).size} bytes)`);
        } catch (err) {
            console.error(`Error on ${task.filename}:`, err.message);
        }
    }

    if (fs.existsSync(tempRaw)) fs.unlinkSync(tempRaw);
    console.log('All story audio files generated successfully!');
}

buildAllAudio();
