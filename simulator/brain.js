/**
 * Robot Brain - Remote Controller & Content Manager
 * Syncs seamlessly with the Robot Face (index.html) and ESP32 via BroadcastChannel & WebSockets
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

    // --- 3. STORY ORCHESTRATION ---
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

    // --- 4. CHILD PROFILE & PERSONALIZATION ---
    setupChildProfile() {
        // Load saved profile
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

    // --- 5. LOGS & TELEMETRY ---
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

    // --- 6. REAL-TIME COMMUNICATION (BROADCAST & WEBSOCKET) ---
    setupSyncBus() {
        this.channel.onmessage = (event) => {
            const data = event.data;
            if (!data) return;

            // Handle incoming events from the Robot Face
            if (data.event === 'TOUCH_TRIGGER') {
                this.logActivity('👉 الطفل لمس رأس الروبوت الآن!', 'event');
            } else if (data.event === 'CHILD_SPOKE') {
                this.logActivity(`🎤 الطفل قال للروبوت: "${data.transcript}"`, 'event');
            } else if (data.event === 'ROBOT_FACE_ONLINE') {
                this.statusDot.style.background = '#10b981';
                this.statusText.innerText = 'وجه الروبوت متصل ونشط 🤖';
                this.logActivity('🤖 تم اكتشاف وجه الروبوت بنجاح');
            }
        };
    }

    broadcastCommand(payload) {
        // 1. Send via local BroadcastChannel
        this.channel.postMessage(payload);

        // 2. Send via WebSocket if connected
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
