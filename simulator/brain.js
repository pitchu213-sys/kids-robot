/**
 * Robot Brain - Remote Controller & Content Manager
 * Syncs seamlessly with the Robot Face (index.html) and ESP32 via BroadcastChannel & WebSockets
 * Features: Google Gemini AI Voice Integration (Puck, Aoede, Kore, Fenrir, Charon)
 */

class RobotBrain {
    constructor() {
        // Elements
        this.statusDot = document.getElementById('brainStatusDot');
        this.statusText = document.getElementById('brainStatusText');
        this.customSpeechText = document.getElementById('customSpeechText');
        this.speechEmotionSelect = document.getElementById('speechEmotionSelect');
        this.sendSpeechBtn = document.getElementById('sendSpeechBtn');
        this.logStream = document.getElementById('logStream');
        this.clearLogsBtn = document.getElementById('clearLogsBtn');
        this.childProfileForm = document.getElementById('childProfileForm');

        // Gemini AI Elements
        this.geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
        this.saveGeminiKeyBtn = document.getElementById('saveGeminiKeyBtn');
        this.testGeminiVoiceBtn = document.getElementById('testGeminiVoiceBtn');
        this.geminiStatusBadge = document.getElementById('geminiStatusBadge');
        this.geminiVoiceSelect = document.getElementById('geminiVoiceSelect');
        this.geminiPromptInput = document.getElementById('geminiPromptInput');
        this.sendToGeminiBtn = document.getElementById('sendToGeminiBtn');
        this.geminiSystemPrompt = document.getElementById('geminiSystemPrompt');

        // Cross-tab / Cross-window Real-time Sync Bus
        this.channel = new BroadcastChannel('kids_robot_bus');
        
        // WebSocket for Backend / Remote ESP32
        this.ws = null;
        this.serverUrl = 'ws://localhost:8000/ws/robot';

        this.init();
    }

    init() {
        this.setupTabs();
        this.setupLiveControls();
        this.setupGeminiAI();
        this.setupStories();
        this.setupChildProfile();
        this.setupLogs();
        this.setupSyncBus();
        this.tryConnectWebSocket();

        // Broadcast ping to discover any open Robot Face
        this.broadcastCommand({ event: 'BRAIN_HELLO', timestamp: Date.now() });
    }

    // --- 1. TABS NAVIGATION ---
    setupTabs() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabPanes = document.querySelectorAll('.tab-pane');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');

                tabBtns.forEach(b => b.classList.remove('active'));
                tabPanes.forEach(p => p.classList.remove('active'));

                btn.classList.add('active');
                const targetPane = document.getElementById(`tab-${targetTab}`);
                if (targetPane) targetPane.classList.add('active');
            });
        });
    }

    // --- 2. LIVE REMOTE CONTROLS ---
    setupLiveControls() {
        // Send Custom Speech
        this.sendSpeechBtn.addEventListener('click', () => {
            const text = this.customSpeechText.value.trim();
            if (!text) {
                alert('الرجاء كتابة الجملة التي تريد أن ينطقها الروبوت!');
                return;
            }

            const face = this.speechEmotionSelect.value;
            this.broadcastCommand({
                event: 'SAY_TEXT',
                text: text,
                face: face,
                led: { pattern: 'spin', color: '#00f2fe' }
            });

            this.logActivity(`🗣️ أمرت الروبوت بنطق: "${text}"`);
        });

        // Quick Preset Phrases
        document.querySelectorAll('.quick-phrase-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.getAttribute('data-text');
                const emotion = btn.getAttribute('data-emotion') || 'happy';
                this.customSpeechText.value = text;
                this.speechEmotionSelect.value = emotion;

                this.broadcastCommand({
                    event: 'SAY_TEXT',
                    text: text,
                    face: emotion,
                    led: { pattern: 'pulse', color: '#a855f7' }
                });

                this.logActivity(`⚡ عبارة سريعة: "${text}"`);
            });
        });

        // Face Emotion Buttons
        document.querySelectorAll('[data-action="face"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const emotion = btn.getAttribute('data-val');
                this.broadcastCommand({
                    event: 'SET_FACE',
                    face: emotion
                });
                this.logActivity(`😊 تغيير تعبير الوجه إلى: ${emotion}`);
            });
        });

        // LED Pattern Buttons
        document.querySelectorAll('[data-action="led"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const pattern = btn.getAttribute('data-val');
                const color = btn.getAttribute('data-color') || '#00f2fe';
                this.broadcastCommand({
                    event: 'SET_LED',
                    led: { pattern: pattern, color: color }
                });
                this.logActivity(`💡 تغيير إضاءة LED إلى: ${pattern}`);
            });
        });
    }

    // --- 3. GOOGLE GEMINI AI VOICE & CHAT INTEGRATION ---
    setupGeminiAI() {
        // Load saved API key & settings
        const savedKey = localStorage.getItem('kids_robot_gemini_key') || '';
        const savedVoice = localStorage.getItem('kids_robot_gemini_voice') || 'Puck';
        const savedPrompt = localStorage.getItem('kids_robot_gemini_prompt');

        if (savedKey) {
            this.geminiApiKeyInput.value = savedKey;
            this.geminiStatusBadge.innerHTML = '🟢 المفتاح محفوظ ومفعّل';
            this.geminiStatusBadge.style.color = '#10b981';
        }

        if (savedVoice) this.geminiVoiceSelect.value = savedVoice;
        if (savedPrompt) this.geminiSystemPrompt.value = savedPrompt;

        // Save Key Button
        this.saveGeminiKeyBtn.addEventListener('click', () => {
            const key = this.geminiApiKeyInput.value.trim();
            if (!key) {
                alert('الرجاء لصق مفتاح Gemini API أولاً!');
                return;
            }
            localStorage.setItem('kids_robot_gemini_key', key);
            localStorage.setItem('kids_robot_gemini_voice', this.geminiVoiceSelect.value);
            localStorage.setItem('kids_robot_gemini_prompt', this.geminiSystemPrompt.value);

            this.geminiStatusBadge.innerHTML = '🟢 تم حفظ المفتاح بنجاح!';
            this.geminiStatusBadge.style.color = '#10b981';
            this.logActivity('💾 تم حفظ مفتاح Google Gemini وتحديث الإعدادات');
            alert('تم حفظ مفتاح Gemini وتفعيل الصوت البشري الذكي بنجاح! 🎉');
        });

        // Test Voice Button
        this.testGeminiVoiceBtn.addEventListener('click', async () => {
            const key = this.geminiApiKeyInput.value.trim();
            if (!key) {
                alert('الرجاء إدخال وحفظ مفتاح Gemini أولاً لتجربة الصوت!');
                return;
            }
            this.logActivity('⏳ جاري طلب صوت Gemini التجريبي من Google...');
            this.testGeminiVoiceBtn.innerText = '⏳ جاري التوليد...';

            try {
                const testMsg = "مرحباً يا بطل! أنا روبوتك الذكي روبي، صوتي الجديد جميل ومرح، هل أنت جاهز للعب معي؟";
                await this.requestGeminiVoice(testMsg, true);
                this.logActivity('🔊 تم استلام صوت Gemini بنجاح وبثه للروبوت!');
            } catch (err) {
                console.error('Gemini test error:', err);
                alert(`خطأ في استدعاء صوت Gemini: ${err.message}\nتأكد من صحة المفتاح.`);
                this.logActivity(`❌ خطأ في صوت Gemini: ${err.message}`, 'error');
            } finally {
                this.testGeminiVoiceBtn.innerText = '🔊 اختبار الصوت';
            }
        });

        // Send Custom Prompt to Gemini
        this.sendToGeminiBtn.addEventListener('click', async () => {
            const prompt = this.geminiPromptInput.value.trim();
            if (!prompt) {
                alert('الرجاء كتابة سؤال أو جملة لـ Gemini!');
                return;
            }

            this.logActivity(`❓ سؤال إلى Gemini: "${prompt}"`);
            this.sendToGeminiBtn.innerText = '⏳ يفكر ويجيب...';

            try {
                await this.requestGeminiVoice(prompt, false);
                this.geminiPromptInput.value = '';
            } catch (err) {
                alert(`خطأ في Gemini: ${err.message}`);
                this.logActivity(`❌ خطأ: ${err.message}`, 'error');
            } finally {
                this.sendToGeminiBtn.innerText = '🗣️ إرسال وسماع الرد';
            }
        });
    }

    /**
     * Calls Google Gemini AI with Automatic Model Fallback Chain & High-Demand Recovery
     */
    async requestGeminiVoice(userPrompt, isDirectTest = false) {
        const apiKey = this.geminiApiKeyInput.value.trim() || localStorage.getItem('kids_robot_gemini_key');
        if (!apiKey) throw new Error('مفتاح Gemini API غير موجود');

        const voiceName = this.geminiVoiceSelect.value || 'Puck';
        const systemPrompt = this.geminiSystemPrompt.value.trim();

        // Model Fallback Chain: prevents 503 / "high demand" bottlenecks
        const candidateModels = [
            'gemini-3.8-flash',
            'gemini-2.5-flash',
            'gemini-1.5-flash',
            'gemini-2.5-pro',
            'gemini-1.5-pro'
        ];

        let lastError = null;

        for (const modelName of candidateModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

                // Step 1: Attempt Multimodal Audio + Text
                let payload = {
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                    generationConfig: {
                        responseModalities: ["AUDIO", "TEXT"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: voiceName }
                            }
                        }
                    }
                };

                let response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                // If audio cluster is busy (high demand) or unsupported, fallback to TEXT on the same model
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData?.error?.message || '';
                    console.warn(`[${modelName}] Audio request error:`, errMsg);

                    // Fallback to pure TEXT generation
                    payload = {
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
                    };

                    response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const errData2 = await response.json().catch(() => ({}));
                        throw new Error(errData2?.error?.message || `HTTP ${response.status}`);
                    }
                }

                const data = await response.json();
                const candidate = data.candidates?.[0];
                if (!candidate) continue;

                let audioBase64 = null;
                let mimeType = 'audio/wav';
                let textReply = '';

                for (const part of candidate.content?.parts || []) {
                    if (part.text) textReply += part.text;
                    if (part.inlineData) {
                        audioBase64 = part.inlineData.data;
                        mimeType = part.inlineData.mimeType || 'audio/wav';
                    }
                }

                if (!textReply && isDirectTest) {
                    textReply = userPrompt;
                }

                this.logActivity(`🤖 رد الذكاء الاصطناعي (${modelName}): "${textReply}"`);

                // Convert PCM/Audio if present
                let finalAudioDataUrl = null;
                if (audioBase64) {
                    if (mimeType.includes('pcm') || !mimeType.includes('wav')) {
                        finalAudioDataUrl = this.pcmBase64ToWavDataUrl(audioBase64, 24000);
                    } else {
                        finalAudioDataUrl = `data:${mimeType};base64,${audioBase64}`;
                    }
                }

                // Broadcast to Robot Face
                if (finalAudioDataUrl) {
                    this.broadcastCommand({
                        event: 'PLAY_GEMINI_AUDIO',
                        audioUrl: finalAudioDataUrl,
                        text: textReply,
                        face: 'speaking',
                        led: { pattern: 'rainbow' }
                    });
                } else {
                    // Smooth spoken voice on Face
                    this.broadcastCommand({
                        event: 'SAY_TEXT',
                        text: textReply,
                        face: 'speaking',
                        led: { pattern: 'spin', color: '#00f2fe' }
                    });
                }

                return { text: textReply, audioUrl: finalAudioDataUrl, model: modelName };
            } catch (err) {
                console.warn(`Model ${modelName} error: ${err.message}. Trying next candidate...`);
                lastError = err;
            }
        }

        throw new Error(lastError ? lastError.message : 'عذراً، خوادم Google تواجه ضغطاً مؤقتاً.');
    }

    /**
     * Converts raw 24kHz 16-bit Mono PCM Base64 to a playable WAV Data URL
     */
    pcmBase64ToWavDataUrl(base64Pcm, sampleRate = 24000) {
        const binaryString = atob(base64Pcm);
        const len = binaryString.length;
        const pcmBytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            pcmBytes[i] = binaryString.charCodeAt(i);
        }

        // Build 44-byte WAV header
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataLength = pcmBytes.length;
        const headerLength = 44;
        const wavBuffer = new ArrayBuffer(headerLength + dataLength);
        const view = new DataView(wavBuffer);

        // "RIFF" chunk descriptor
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        this.writeString(view, 8, 'WAVE');

        // "fmt " sub-chunk
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // Subchunk1Size
        view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);

        // "data" sub-chunk
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        // Copy PCM samples
        const wavBytes = new Uint8Array(wavBuffer);
        wavBytes.set(pcmBytes, 44);

        // Convert to Blob and Data URL
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        return URL.createObjectURL(blob);
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    // --- 4. STORY ORCHESTRATION ---
    setupStories() {
        const spaceBtn = document.getElementById('launchSpaceStory');
        const animalsBtn = document.getElementById('launchAnimalsStory');

        if (spaceBtn) {
            spaceBtn.addEventListener('click', () => {
                this.broadcastCommand({
                    event: 'START_STORY',
                    story_id: 'space'
                });
                this.logActivity('🚀 إطلاق قصة رحلة رائد الفضاء الصغير على الروبوت');
            });
        }

        if (animalsBtn) {
            animalsBtn.addEventListener('click', () => {
                this.broadcastCommand({
                    event: 'START_STORY',
                    story_id: 'animals'
                });
                this.logActivity('🦁 إطلاق قصة أصدقاء الغابة السحرية على الروبوت');
            });
        }
    }

    // --- 5. CHILD PROFILE & PERSONALIZATION ---
    setupChildProfile() {
        const saved = localStorage.getItem('kids_robot_child_profile');
        if (saved) {
            try {
                const p = JSON.parse(saved);
                if (p.name) document.getElementById('childName').value = p.name;
                if (p.age) document.getElementById('childAge').value = p.age;
                if (p.interests) document.getElementById('childInterests').value = p.interests;
                if (p.notes) document.getElementById('parentNotes').value = p.notes;
            } catch (e) {}
        }

        this.childProfileForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const profile = {
                name: document.getElementById('childName').value.trim(),
                age: document.getElementById('childAge').value.trim(),
                interests: document.getElementById('childInterests').value.trim(),
                notes: document.getElementById('parentNotes').value.trim()
            };

            localStorage.setItem('kids_robot_child_profile', JSON.stringify(profile));
            this.broadcastCommand({
                event: 'CHILD_PROFILE_UPDATED',
                profile: profile
            });

            this.logActivity(`💾 تم حفظ بيانات الطفل: ${profile.name} (${profile.age} سنوات)`);
            alert('تم حفظ وتحديث بيانات الطفل في عقل الروبوت بنجاح! 🎉');
        });
    }

    // --- 6. LOGS & TELEMETRY ---
    setupLogs() {
        this.clearLogsBtn.addEventListener('click', () => {
            this.logStream.innerHTML = '';
            this.logActivity('تم مسح السجل');
        });
    }

    logActivity(msg, type = 'info') {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const item = document.createElement('div');
        item.className = `log-item ${type}`;
        item.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-msg">${msg}</span>`;
        this.logStream.prepend(item);
    }

    // --- 7. REAL-TIME COMMUNICATION (BROADCAST & WEBSOCKET) ---
    setupSyncBus() {
        this.channel.onmessage = async (event) => {
            const data = event.data;
            if (!data) return;

            // Handle incoming events from the Robot Face
            if (data.event === 'TOUCH_TRIGGER') {
                this.logActivity('👉 الطفل لمس رأس الروبوت الآن!', 'event');
            } else if (data.event === 'CHILD_SPOKE') {
                this.logActivity(`🎤 الطفل قال للروبوت: "${data.transcript}"`, 'event');

                // If Gemini key is set, automatically respond to the child with Gemini Voice!
                const key = this.geminiApiKeyInput?.value.trim() || localStorage.getItem('kids_robot_gemini_key');
                if (key && data.transcript) {
                    this.logActivity('🤖 Gemini يجيب على صوت الطفل بصوته البشري...');
                    try {
                        await this.requestGeminiVoice(data.transcript, false);
                    } catch (e) {
                        console.error('Auto Gemini reply error:', e);
                    }
                }
            } else if (data.event === 'ROBOT_FACE_ONLINE') {
                this.statusDot.style.background = '#10b981';
                this.statusText.innerText = 'وجه الروبوت متصل ونشط 🤖';
                this.logActivity('🤖 تم اكتشاف وجه الروبوت بنجاح');
            }
        };
    }

    broadcastCommand(payload) {
        this.channel.postMessage(payload);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    tryConnectWebSocket() {
        try {
            this.ws = new WebSocket(this.serverUrl);
            this.ws.onopen = () => {
                this.statusDot.style.background = '#10b981';
                this.statusText.innerText = 'متصل بالسيرفر وعقل الروبوت 🧠';
                this.logActivity('السيرفر السحابي متصل');
            };
            this.ws.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.event === 'TOUCH_TRIGGER') {
                        this.logActivity('👉 الطفل لمس رأس الروبوت (عبر السيرفر)', 'event');
                    }
                } catch (err) {}
            };
            this.ws.onclose = () => {
                this.statusText.innerText = 'متصل محلياً بوجه الروبوت (Cross-Tab)';
            };
        } catch (e) {
            this.statusText.innerText = 'متصل محلياً بوجه الروبوت (Cross-Tab)';
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.brain = new RobotBrain();
});
