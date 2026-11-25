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
        
        // QA Library & Voice Blocks State
        this.qaLibrary = [];
        this.voiceBlocks = [];

        // WebSocket for Backend / Remote ESP32
        this.ws = null;
        this.serverUrl = 'ws://localhost:8000/ws/robot';

        this.init();
    }

    init() {
        this.setupTabs();
        this.setupLiveControls();
        this.setupQALibrary();
        this.setupVoiceBlocks();
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

    // --- 2.5. CUSTOM QA LIBRARY MANAGEMENT ---
    async setupQALibrary() {
        this.qaCardsContainer = document.getElementById('qaCardsContainer');
        this.refreshQABtn = document.getElementById('refreshQABtn');
        this.testQAMatchBtn = document.getElementById('testQAMatchBtn');
        this.testQATriggerInput = document.getElementById('testQATriggerInput');
        this.testQAResult = document.getElementById('testQAResult');

        if (this.refreshQABtn) {
            this.refreshQABtn.addEventListener('click', () => {
                this.loadQALibrary();
            });
        }

        if (this.testQAMatchBtn && this.testQATriggerInput) {
            this.testQAMatchBtn.addEventListener('click', () => {
                this.testQAMatch();
            });
            this.testQATriggerInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.testQAMatch();
            });
        }

        await this.loadQALibrary();
    }

    normalizeArabic(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .replace(/[\u064B-\u065F\u0670]/g, '') // remove diacritics / tashkeel
            .replace(/[إأآا]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/[؟?.,!،؛:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    findMatchingQA(transcript) {
        if (!this.qaLibrary || !this.qaLibrary.length) return null;
        const normInput = this.normalizeArabic(transcript);
        if (!normInput) return null;

        const stopWords = ['يا', 'في', 'من', 'على', 'هل', 'هو', 'هي', 'مع', 'و', 'ان', 'ما', 'عن'];
        const inputWords = normInput.split(' ').filter(w => w.length > 1 && !stopWords.includes(w));

        let bestItem = null;
        let highestScore = 0;

        for (const item of this.qaLibrary) {
            let score = 0;
            const normTitle = this.normalizeArabic(item.title || '');
            const normCat = this.normalizeArabic(item.category || '');

            // 1. Exact match with title or category
            if (normInput === normTitle) score += 1000;
            if (normInput === normCat) score += 800;

            // Substring / partial of title or category
            if (normInput.includes(normTitle) || (normInput.length >= 4 && normTitle.includes(normInput))) {
                score += 400;
            }
            if (normCat && (normInput.includes(normCat) || (normInput.length >= 4 && normCat.includes(normInput)))) {
                score += 300;
            }

            // Title and Category word overlap
            const metaWords = (normTitle + ' ' + normCat).split(' ').filter(w => w.length > 2 && !stopWords.includes(w));
            for (const w of inputWords) {
                if (metaWords.includes(w)) score += 150;
            }

            // 2. Triggers (Tunisian dialect & MSA)
            if (item.triggers) {
                for (const trig of item.triggers) {
                    const normTrig = this.normalizeArabic(trig);
                    if (!normTrig) continue;

                    if (normInput === normTrig) {
                        score += 1000;
                    } else if (normInput.includes(normTrig)) {
                        score += 500 + normTrig.length * 5;
                    } else if (normTrig.includes(normInput) && normInput.length >= 3) {
                        score += 250 + normInput.length * 5;
                    } else {
                        // Word overlap
                        const trigWords = normTrig.split(' ').filter(w => w.length > 1 && !stopWords.includes(w));
                        let matchedWords = 0;
                        for (const tw of trigWords) {
                            if (inputWords.includes(tw)) matchedWords++;
                        }
                        if (matchedWords > 0) {
                            score += (matchedWords / trigWords.length) * 200;
                        }
                    }
                }
            }

            if (score > highestScore) {
                highestScore = score;
                bestItem = item;
            }
        }

        return highestScore >= 100 ? bestItem : null;
    }

    testQAMatch() {
        const val = this.testQATriggerInput?.value.trim();
        if (!val) {
            if (this.testQAResult) this.testQAResult.innerHTML = `<span style="color:#ef4444;">يرجى كتابة جملة لاختبارها</span>`;
            return;
        }

        const match = this.findMatchingQA(val);
        if (match) {
            if (this.testQAResult) {
                this.testQAResult.innerHTML = `
                    <div style="background:rgba(16,185,129,0.15); border:1px solid #10b981; border-radius:8px; padding:10px; color:#34d399;">
                        ✅ <strong>تمت المطابقة بنجاح!</strong> الرد المحدد: <em>"${match.response_text}"</em>
                        <button class="btn-primary" style="margin-right:10px; padding:4px 10px; font-size:0.8rem;" onclick="window.brain.triggerQAOnRobot('${match.id}')">🚀 تشغيل الآن على الروبوت</button>
                    </div>
                `;
            }
            this.triggerQAOnRobot(match.id);
        } else {
            if (this.testQAResult) {
                this.testQAResult.innerHTML = `
                    <div style="background:rgba(239,68,68,0.15); border:1px solid #ef4444; border-radius:8px; padding:10px; color:#f87171;">
                        ℹ️ لم يتم العثور على رد مباشر في المكتبة. في هذه الحالة، سينتقل الروبوت فوراً لتوليد إجابة ذكية عبر <strong>Google Gemini</strong>.
                    </div>
                `;
            }
        }
    }

    triggerQAOnRobot(id) {
        const item = (this.qaLibrary || []).find(q => q.id === id);
        if (item) {
            this.broadcastCommand({
                event: 'PLAY_QA_ENTRY',
                id: item.id
            });
            this.logActivity(`📢 تشغيل الرد المسجل: "${item.title}" على الروبوت`);

            // Also play audio directly in Brain tab if clicked
            if (item.audio) {
                const aud = new Audio(item.audio);
                aud.play().catch(() => {});
            }
        }
    }

    async loadQALibrary() {
        try {
            const res = await fetch('qa_library.json?v=' + Date.now());
            if (res.ok) {
                this.qaLibrary = await res.json();
                this.renderQACards();
                this.logActivity(`📚 تم تحميل مكتبة الردود (${this.qaLibrary.length} ردود معتمدة)`);
            }
        } catch (e) {
            console.warn('Failed to load QA library:', e);
        }
    }

    renderQACards() {
        if (!this.qaCardsContainer) return;
        this.qaCardsContainer.innerHTML = '';

        if (!this.qaLibrary || !this.qaLibrary.length) {
            this.qaCardsContainer.innerHTML = '<p style="color:#94a3b8;">لا توجد ردود مسجلة بعد في المكتبة.</p>';
            return;
        }

        const emotionLabels = {
            happy: '😊 فرحان',
            wonder: '🤩 مندهش',
            love: '❤️ حب وتشجيع',
            curious: '🤔 فضولي',
            sleepy: '😴 ناعس'
        };

        this.qaLibrary.forEach(item => {
            const card = document.createElement('div');
            card.className = 'qa-card';

            const triggersHtml = (item.triggers || []).map(t => `<span class="qa-trigger-pill">${t}</span>`).join('');
            const emotionText = emotionLabels[item.emotion] || item.emotion;

            card.innerHTML = `
                <div class="qa-header">
                    <div class="qa-title">
                        <span>🎙️</span>
                        <span>${item.title || item.id}</span>
                    </div>
                    <div class="qa-badges">
                        <span class="qa-badge qa-badge-emotion">${emotionText}</span>
                        <span class="qa-badge qa-badge-voice">صوت بشري مسجل 🎧</span>
                    </div>
                </div>

                <div class="qa-text-bubble">
                    ${item.response_text}
                </div>

                <div>
                    <div class="qa-triggers-label">الكلمات والجمل المفتاحية التي ينطق بها الطفل:</div>
                    <div class="qa-triggers-list">
                        ${triggersHtml}
                    </div>
                </div>

                <div class="qa-actions">
                    <div class="qa-audio-player">
                        <audio controls preload="none" src="${item.audio}"></audio>
                    </div>
                    <button class="btn-primary qa-play-btn" data-id="${item.id}" style="font-size:0.85rem; padding:6px 14px;">
                        🚀 تشغيل على شاشة الروبوت
                    </button>
                </div>
            `;

            const playBtn = card.querySelector('.qa-play-btn');
            if (playBtn) {
                playBtn.addEventListener('click', () => {
                    this.triggerQAOnRobot(item.id);
                });
            }

            this.qaCardsContainer.appendChild(card);
        });
    }

    // --- 2.8. MODULAR VOICE BLOCKS & AI COMPOSER ---
    async setupVoiceBlocks() {
        this.voiceBlocksContainer = document.getElementById('voiceBlocksContainer');
        this.blocksProgressBadge = document.getElementById('blocksProgressBadge');
        this.composerTestInput = document.getElementById('composerTestInput');
        this.composerTestBtn = document.getElementById('composerTestBtn');
        this.composerTestResult = document.getElementById('composerTestResult');
        this.currentBlockFilter = 'all';

        // Filter Bar Buttons
        const filterBtns = document.querySelectorAll('#blockFilterBar .quick-phrase-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active-filter'));
                btn.classList.add('active-filter');
                this.currentBlockFilter = btn.getAttribute('data-role') || 'all';
                this.renderVoiceBlocks();
            });
        });

        // Test Composer Button
        if (this.composerTestBtn && this.composerTestInput) {
            this.composerTestBtn.addEventListener('click', () => this.testAIComposer());
            this.composerTestInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.testAIComposer();
            });
        }

        await this.loadVoiceBlocks();
    }

    async loadVoiceBlocks() {
        try {
            const res = await fetch('voice_blocks.json?v=' + Date.now());
            if (res.ok) {
                this.voiceBlocks = await res.json();
                this.renderVoiceBlocks();
                if (this.blocksProgressBadge) {
                    const recordedCount = this.voiceBlocks.filter(b => b.recorded).length;
                    this.blocksProgressBadge.innerText = `اللبنات: ${this.voiceBlocks.length} (${recordedCount} مسجل صوتياً)`;
                }
            }
        } catch (e) {
            console.warn('Could not load voice_blocks.json in Brain:', e);
        }
    }

    renderVoiceBlocks() {
        if (!this.voiceBlocksContainer) return;
        this.voiceBlocksContainer.innerHTML = '';

        const emotionLabels = {
            happy: '😊 سعيد',
            wonder: '🤩 مندهش',
            curious: '🤔 فضولي',
            love: '❤️ حب/حنان',
            sleepy: '😴 ناعس/هادئ'
        };

        const filtered = (this.voiceBlocks || []).filter(b => {
            if (this.currentBlockFilter === 'all') return true;
            return b.role === this.currentBlockFilter;
        });

        if (filtered.length === 0) {
            this.voiceBlocksContainer.innerHTML = '<p style="color:#94a3b8; padding:12px;">لا توجد لبنات مطابقة لهذا القسم.</p>';
            return;
        }

        filtered.forEach(block => {
            const card = document.createElement('div');
            card.className = 'block-card';

            const emotionText = emotionLabels[block.emotion] || block.emotion;
            const numberBadge = block.number ? `<span style="font-weight:900; color:#38bdf8; margin-left:4px;">#${block.number}</span>` : '';

            card.innerHTML = `
                <div class="block-top">
                    <div>
                        ${numberBadge}
                        <span class="block-id">${block.id}</span>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <span class="qa-badge qa-badge-emotion">${emotionText}</span>
                        <span class="qa-badge qa-badge-voice">🎙️ صوت مسجل</span>
                    </div>
                </div>

                <div class="block-template">
                    ${block.text}
                </div>

                <div class="block-footer" style="flex-wrap:wrap; gap:8px;">
                    <audio controls preload="none" src="${block.audio}" style="height:28px; max-width:180px;"></audio>
                    <button class="btn-primary play-robot-btn" style="padding:4px 12px; font-size:0.8rem;">
                        🚀 شغّل على الروبوت
                    </button>
                </div>
            `;

            // Trigger on robot face
            card.querySelector('.play-robot-btn').addEventListener('click', () => {
                this.broadcastCommand({
                    event: 'PLAY_VOICE_BLOCK',
                    id: block.id,
                    block: block
                });
                this.logActivity(`🧩 تشغيل اللبنة الصوتية: [#${block.number || ''} ${block.id}] "${block.text}"`);
            });

            this.voiceBlocksContainer.appendChild(card);
        });
    }

    async testAIComposer() {
        const text = this.composerTestInput?.value.trim();
        if (!text) {
            alert('الرجاء كتابة جملة تجريبية يقولها الطفل!');
            return;
        }

        const apiKey = this.geminiApiKeyInput?.value.trim() || localStorage.getItem('kids_robot_gemini_key');
        if (!apiKey) {
            alert('الرجاء إدخال وحفظ مفتاح Gemini API أولاً لتجربة التركيب الذكي!');
            return;
        }

        if (!this.voiceBlocks || this.voiceBlocks.length === 0) {
            alert('جاري تحميل اللبنات الصوتية، حاول بعد لحظة.');
            return;
        }

        this.composerTestBtn.disabled = true;
        this.composerTestBtn.innerText = '🧠 جاري التفكير وتركيب الرد...';
        if (this.composerTestResult) {
            this.composerTestResult.innerHTML = '<span style="color:#00f2fe;">⏳ Gemini يحلل كلام الطفل ويختار أنسب اللبنات المتتالية...</span>';
        }

        try {
            let childProfile = null;
            try {
                const saved = localStorage.getItem('kids_robot_child_profile');
                if (saved) childProfile = JSON.parse(saved);
            } catch (e) {}

            const promptText = window.KidsRobotQA.buildComposerPrompt(
                this.voiceBlocks,
                text,
                childProfile,
                this.geminiSystemPrompt?.value
            );

            const payload = {
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: {
                    maxOutputTokens: 140,
                    temperature: 0.4
                }
            };

            const models = await this.fetchAvailableModels(apiKey);
            let raw = '';
            let requestError = null;
            for (const modelName of models) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const googleError = data?.error || {};
                    const reasons = (googleError.details || []).map(detail => detail.reason).filter(Boolean).join(', ');
                    requestError = new Error(this.describeParentGeminiError(
                        `${googleError.status || `HTTP_${res.status}`}${reasons ? ` (${reasons})` : ''}: ${googleError.message || 'Google returned no message.'}`
                    ));
                    if ([401, 403, 429].includes(res.status) || googleError.status === 'RESOURCE_EXHAUSTED') break;
                    continue;
                }
                const candidate = data.candidates?.[0];
                raw = (candidate?.content?.parts || []).map(part => part.text || '').join('').trim();
                if (raw) break;
                requestError = new Error(`Gemini أعاد استجابة بلا نص (finishReason: ${candidate?.finishReason || data.promptFeedback?.blockReason || 'غير متاح'}).`);
            }
            if (!raw) throw requestError || new Error('لم تُرجع Google نصاً لهذا الطلب.');
            const parsed = window.KidsRobotQA.parseComposerReply(raw, this.voiceBlocks);

            const chipsHtml = parsed.steps.map(s => `
                <span class="composer-chip">
                    ${s.role === 'dynamic' ? '⚡ ذكي' : '🧩 ' + s.id} (${s.emotion}): "${s.text}"
                </span>
            `).join(' ➔ ');

            if (this.composerTestResult) {
                this.composerTestResult.innerHTML = `
                    <div style="background:rgba(16,185,129,0.14); border:1px solid #10b981; border-radius:10px; padding:12px; color:#f1f5f9;">
                        <div style="font-weight:700; color:#34d399; margin-bottom:6px;">
                            ✨ تم تركيب الرد بنجاح (الوضع: ${parsed.mode === 'blocks' ? 'لبنات مسجلة' : (parsed.mode === 'hybrid' ? 'هجين ذكي' : 'رد نصي ذكي')}):
                        </div>
                        <div class="composer-sequence-chips">${chipsHtml}</div>
                    </div>
                `;
            }

            // Broadcast sequence to robot face
            this.broadcastCommand({
                event: 'PLAY_BLOCK_SEQUENCE',
                steps: parsed.steps
            });
            this.logActivity(`✨ تركيب رد متسلسل لـ "${text}": ${parsed.steps.map(s => s.id).join(' + ')}`);
        } catch (e) {
            console.error('Composer test error:', e);
            this.geminiStatusBadge.textContent = `⚠️ ${this.describeParentGeminiError(e.message)}`;
            this.geminiStatusBadge.style.color = '#f59e0b';
            if (this.composerTestResult) {
                this.composerTestResult.innerHTML = `<span style="color:#ef4444;">❌ فشل التركيب: ${e.message}</span>`;
            }
        } finally {
            this.composerTestBtn.disabled = false;
            this.composerTestBtn.innerText = '✨ ركّب وشغّل الرد بالذكاء الاصطناعي';
        }
    }

    // --- 3. GOOGLE GEMINI AI VOICE & CHAT INTEGRATION ---
    setupGeminiAI() {
        this.availableModels = [];
        // Load saved API key & settings
        const savedKey = localStorage.getItem('kids_robot_gemini_key') || '';
        const savedVoice = localStorage.getItem('kids_robot_gemini_voice') || 'Puck';
        const savedPrompt = localStorage.getItem('kids_robot_gemini_prompt');

        if (savedKey) {
            this.geminiApiKeyInput.value = savedKey;
            this.geminiStatusBadge.innerHTML = '🟢 المفتاح محفوظ ومفعّل';
            this.geminiStatusBadge.style.color = '#10b981';
            // Pre-fetch actual active models from Google
            this.fetchAvailableModels(savedKey).catch(err => {
                this.geminiStatusBadge.textContent = `⚠️ ${this.describeParentGeminiError(err.message)}`;
                this.geminiStatusBadge.style.color = '#f59e0b';
            });
        }

        if (savedVoice) this.geminiVoiceSelect.value = savedVoice;
        if (savedPrompt) this.geminiSystemPrompt.value = savedPrompt;

        // Dialect Selector
        const langSelect = document.getElementById('speechLangSelect');
        if (langSelect) {
            langSelect.value = localStorage.getItem('kids_robot_lang') || 'ar-TN';
            langSelect.addEventListener('change', () => {
                const newLang = langSelect.value;
                localStorage.setItem('kids_robot_lang', newLang);
                this.broadcastCommand({ event: 'SET_RECOGNITION_LANG', lang: newLang });
                this.logActivity(`🌐 تغيير لهجة الاستماع إلى: ${newLang}`);
            });
        }

        // Save Key Button
        this.saveGeminiKeyBtn.addEventListener('click', async () => {
            const key = this.geminiApiKeyInput.value.trim();
            if (!key) {
                alert('الرجاء لصق مفتاح Gemini API أولاً!');
                return;
            }
            this.geminiStatusBadge.innerHTML = '⏳ جاري فحص والتحقق من المفتاح مع Google...';
            this.geminiStatusBadge.style.color = '#f59e0b';
            this.availableModels = [];
            try {
                const models = await this.fetchAvailableModels(key);
                localStorage.setItem('kids_robot_gemini_key', key);
                localStorage.setItem('kids_robot_gemini_voice', this.geminiVoiceSelect.value);
                localStorage.setItem('kids_robot_gemini_prompt', this.geminiSystemPrompt.value);

                this.geminiStatusBadge.textContent = `🟢 متصل بنجاح! النماذج المتاحة: ${models.slice(0, 2).join(', ')}`;
                this.geminiStatusBadge.style.color = '#10b981';
                this.logActivity(`💾 تم فحص المفتاح بنجاح! النماذج المتاحة: ${models.join(', ')}`);
                alert(`تم التحقق من المفتاح بنجاح! 🎉\nالنماذج النشطة في حسابك: ${models.slice(0, 3).join(', ')}`);
            } catch (err) {
                this.geminiStatusBadge.textContent = `⚠️ ${this.describeParentGeminiError(err.message)}`;
                this.geminiStatusBadge.style.color = '#ef4444';
                this.logActivity(`❌ تعذر التحقق من المفتاح: ${err.message}`, 'error');
                alert(`تعذر التحقق من المفتاح.\n${this.describeParentGeminiError(err.message)}`);
            }
        });

        // Test Voice Button
        this.testGeminiVoiceBtn.addEventListener('click', async () => {
            const key = this.geminiApiKeyInput.value.trim() || localStorage.getItem('kids_robot_gemini_key');
            if (!key) {
                alert('الرجاء إدخال وحفظ مفتاح Gemini أولاً لتجربة الصوت!');
                return;
            }
            this.logActivity('⏳ جاري طلب واختبار الصوت من Google...');
            this.testGeminiVoiceBtn.innerText = '⏳ جاري التوليد...';

            try {
                const testMsg = "مرحباً يا بطل! أنا روبوتك الذكي، هل أنت مستعد لنبدأ مغامرتنا؟";
                const result = await this.requestGeminiVoice(testMsg, true);
                this.logActivity(`🔊 تم بنجاح! الروبوت يتكلم: "${result.text}"`);
            } catch (err) {
                console.error('Gemini test error:', err);
                this.geminiStatusBadge.textContent = `⚠️ ${this.describeParentGeminiError(err.message)}`;
                this.geminiStatusBadge.style.color = '#f59e0b';
                this.logActivity(`❌ تعذر الاتصال بـ Gemini (${err.message})، جاري تشغيل الصوت التجريبي المحلي...`, 'warn');
                // Play an existing recording; keep this fallback local and free.
                const localAudioUrl = 'audio/blocks/open_friend.mp3';
                this.playAudioDirectly(localAudioUrl, 'مرحباً يا صديقي الجميل!');
                this.broadcastCommand({
                    event: 'PLAY_VOICE_BLOCK',
                    id: 'open_friend',
                    face: 'happy',
                    led: { pattern: 'spin', color: '#00f2fe' }
                });
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
                this.geminiStatusBadge.textContent = `⚠️ ${this.describeParentGeminiError(err.message)}`;
                this.geminiStatusBadge.style.color = '#f59e0b';
                alert(`خطأ في Gemini: ${err.message}`);
                this.logActivity(`❌ خطأ: ${err.message}`, 'error');
            } finally {
                this.sendToGeminiBtn.innerText = '🗣️ إرسال وسماع الرد';
            }
        });
    }

    /**
     * Dynamically queries Google API for exact active models for this key
     */
    async fetchAvailableModels(apiKey) {
        if (this.availableModels && this.availableModels.length > 0) return this.availableModels;
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(this.describeParentGeminiError(data?.error?.message || `HTTP ${res.status}`));
        const valid = (data.models || [])
            .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
            .map(model => model.name.replace(/^models\//, ''));
        valid.sort((a, b) => Number(b.includes('flash')) - Number(a.includes('flash')));
        if (!valid.length) throw new Error('لم تُرجع Google نموذجاً يدعم generateContent لهذا المفتاح.');
        this.availableModels = valid;
        return valid;
    }

    /**
     * Calls Google Gemini AI dynamically with the exact active model returned by Google
     */
    async requestGeminiVoice(userPrompt, isDirectTest = false) {
        const apiKey = this.geminiApiKeyInput.value.trim() || localStorage.getItem('kids_robot_gemini_key');
        if (!apiKey) throw new Error('مفتاح Gemini API غير موجود');

        // Rate limit spacer: ensure at least 2 seconds between calls to prevent 429
        const now = Date.now();
        if (this.lastGeminiCallTime && (now - this.lastGeminiCallTime < 2000)) {
            const waitMs = 2000 - (now - this.lastGeminiCallTime);
            this.logActivity(`⏳ انتظار ${Math.ceil(waitMs/1000)} ثانية لمنع ضغط Google...`);
            await new Promise(r => setTimeout(r, waitMs));
        }
        this.lastGeminiCallTime = Date.now();

        const systemPrompt = this.geminiSystemPrompt.value.trim();

        // Dynamically get the models Google currently provides
        const models = await this.fetchAvailableModels(apiKey);
        let lastError = null;

        for (const modelName of models) {
            try {
                this.logActivity(`جاري استدعاء نموذج (${modelName})...`);
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

                // The child flow composes recorded blocks, so text-only generation
                // avoids paid TTS paths and preserves the free Gemini quota.
                const payload = {
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                    generationConfig: {
                        maxOutputTokens: 140,
                        temperature: 0.45
                    }
                };

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const googleError = errData?.error || {};
                    const reason = (googleError.details || []).map(detail => detail.reason).filter(Boolean).join(', ');
                    throw new Error(this.describeParentGeminiError(`${googleError.status || `HTTP_${response.status}`}${reason ? ` (${reason})` : ''}: ${googleError.message || 'Google returned no message.'}`));
                }

                const data = await response.json();
                const candidate = data.candidates?.[0];
                let textReply = (candidate?.content?.parts || []).map(part => part.text || '').join('').trim();
                if (!textReply && isDirectTest) textReply = userPrompt;
                if (!textReply) throw new Error(`Gemini أعاد استجابة بلا نص (finishReason: ${candidate?.finishReason || data.promptFeedback?.blockReason || 'غير متاح'}).`);

                this.logActivity(`🤖 رد الذكاء الاصطناعي (${modelName}): "${textReply}"`);

                const finalAudioDataUrl = null;

                // 1. Play directly HERE on brain.html so parent hears it immediately
                this.playAudioDirectly(finalAudioDataUrl, textReply);

                // 2. Broadcast to Robot Face (index.html) so child screen reacts simultaneously
                this.broadcastCommand({
                    event: 'PLAY_GEMINI_AUDIO',
                    audioUrl: finalAudioDataUrl,
                    text: textReply,
                    face: 'speaking',
                    led: { pattern: 'spin', color: '#00f2fe' }
                });

                return { text: textReply, audioUrl: finalAudioDataUrl, model: modelName };
            } catch (err) {
                console.warn(`Model ${modelName} error: ${err.message}`);
                lastError = err;
                if (/RESOURCE_EXHAUSTED|429|quota/i.test(err.message)) break;
            }
        }

        throw new Error(lastError ? lastError.message : 'تعذر الاتصال بنماذج Google حالياً.');
    }

    /**
     * Plays audio directly inside brain.html for instant test feedback
     */
    playAudioDirectly(audioUrl, fallbackText) {
        if (this.currentPlayingAudio) {
            try {
                this.currentPlayingAudio.pause();
                this.currentPlayingAudio.currentTime = 0;
            } catch (e) {}
            this.currentPlayingAudio = null;
        }

        const doFallback = () => {
            if (fallbackText) this.speakWebSpeech(fallbackText);
        };

        if (audioUrl) {
            try {
                const audio = new Audio(audioUrl);
                this.currentPlayingAudio = audio;
                const p = audio.play();
                if (p !== undefined) {
                    p.catch(err => {
                        console.warn('Direct audio play error:', err);
                        doFallback();
                    });
                }
            } catch (e) {
                doFallback();
            }
        } else {
            doFallback();
        }
    }

    speakWebSpeech(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const ut = new SpeechSynthesisUtterance(text);
        ut.lang = 'ar-SA';
        ut.rate = 0.92;
        ut.pitch = 1.25;
        const voices = window.speechSynthesis.getVoices();
        const ar = voices.find(v => v.lang.startsWith('ar'));
        if (ar) ut.voice = ar;
        window.speechSynthesis.speak(ut);
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
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = timeStr;
        const message = document.createElement('span');
        message.className = 'log-msg';
        message.textContent = msg;
        item.append(time, document.createTextNode(' '), message);
        this.logStream.prepend(item);
    }

    describeParentGeminiError(error) {
        const value = String(error || 'خطأ غير معروف');
        if (/RESOURCE_EXHAUSTED|429|quota|rate.?limit/i.test(value)) {
            return `انتهت حصة Gemini المجانية أو تم تجاوز حد الطلبات. ينتظر الروبوت تجدد الحصة ويستخدم تسجيلاً محلياً الآن. تفاصيل Google: ${value}`;
        }
        if (/API_KEY_INVALID|invalid api key|API key not valid/i.test(value)) {
            return `رفضت Google مفتاح API. راجع المفتاح وإعدادات Google AI Studio. تفاصيل Google: ${value}`;
        }
        if (/PERMISSION_DENIED|403/i.test(value)) {
            return `رفضت Google صلاحية هذا المفتاح أو النموذج. تحقق من تفعيل Gemini API للمفتاح. تفاصيل Google: ${value}`;
        }
        if (/NOT_FOUND|404|not found/i.test(value)) {
            return `النموذج الذي أُعيد غير متاح. تم طلب قائمة النماذج من Google مباشرة؛ تحقق من صلاحية النموذج لهذا المفتاح. تفاصيل Google: ${value}`;
        }
        if (/Failed to fetch|NetworkError|fetch/i.test(value)) {
            return `تعذر الوصول إلى Google بسبب الاتصال أو إعدادات الشبكة. شُغّل تسجيل محلي للطفل. تفاصيل المتصفح: ${value}`;
        }
        return `تعذر إنشاء رد عبر Gemini؛ شُغّل تسجيل محلي للطفل. تفاصيل Google: ${value}`;
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
            } else if (data.event === 'ROBOT_REPLIED') {
                const badge = data.source === 'qa_library' ? '🎙️ [مكتبة الردود المسجلة]'
                    : (data.source === 'local_fallback' ? '🎙️ [رد محلي احتياطي]' : '⚡ [ذكاء Gemini]');
                this.logActivity(`🤖 الروبوت أجاب: "${data.reply}" ${badge}`);
            } else if (data.event === 'ROBOT_ERROR') {
                const detail = this.describeParentGeminiError(data.error || data.code);
                this.geminiStatusBadge.textContent = `⚠️ ${detail}`;
                this.geminiStatusBadge.style.color = '#f59e0b';
                this.logActivity(`⚠️ تشخيص Gemini (${data.code || 'خطأ'}): ${detail}`, 'warn');
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
