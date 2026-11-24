/**
 * Kids Robot - Digital Twin Simulator & Mobile Web App
 * Controls: GC9A01 240x240 Face Canvas, 12 WS2812 Neopixel LEDs, TTP223 Touch, TTS & Speech Recognition
 */

class RobotSimulator {
    constructor() {
        // Elements
        this.canvas = document.getElementById('faceCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.ledElements = document.querySelectorAll('.neopixel-led');
        this.touchZone = document.getElementById('headTouchZone');
        this.storyText = document.getElementById('storyText');
        this.micBtn = document.getElementById('micBtn');
        this.nextBtn = document.getElementById('nextStoryBtn');
        this.settingsBtn = document.getElementById('toggleDrawerBtn');
        this.closeDrawerBtn = document.getElementById('closeDrawerBtn');
        this.controlDrawer = document.getElementById('controlDrawer');
        this.voiceWave = document.getElementById('voiceWaveContainer');
        this.serverStatusDot = document.getElementById('serverStatusDot');
        this.serverStatusText = document.getElementById('serverStatusText');
        this.storySelector = document.getElementById('storySelector');
        this.restartStoryBtn = document.getElementById('restartStoryBtn');
        this.reconnectBtn = document.getElementById('reconnectBtn');
        this.serverUrlInput = document.getElementById('serverUrlInput');

        // State
        this.emotion = 'happy';
        this.targetEmotion = 'happy';
        this.blinkProgress = 0; // 0 = open, 1 = closed
        this.isBlinking = false;
        this.lastBlinkTime = Date.now();
        this.blinkInterval = 3500;
        
        // Eye parameters
        this.eyeXOffset = 0;
        this.eyeYOffset = 0;
        this.eyeWidth = 42;
        this.eyeHeight = 56;
        this.eyeRadius = 18;
        this.eyeSpacing = 46; // Distance from center
        this.eyeColor = '#00f2fe';

        // LED Ring State
        this.ledPattern = 'spin';
        this.ledColor = '#00f2fe';
        this.ledStep = 0;
        this.ledInterval = null;

        // Audio & Speech
        this.isSpeaking = false;
        this.isListening = false;
        this.speechSynth = window.speechSynthesis;
        this.recognition = null;
        this.audioCtx = null;

        // WebSocket
        this.ws = null;
        this.isConnected = false;
        this.serverUrl = 'ws://localhost:8000/ws/robot';

        // Story State Machine
        this.currentStory = null;
        this.storyIndex = 0;
        this.waitingForAction = null; // 'touch', 'voice', null

        // Cross-tab / Multi-device Sync Bus with Robot Brain
        this.bus = new BroadcastChannel('kids_robot_bus');
        this.setupBusListener();

        // Notify Brain that Robot Face is active
        this.bus.postMessage({ event: 'ROBOT_FACE_ONLINE' });

        this.init();
    }

    setupBusListener() {
        this.bus.onmessage = (event) => {
            const data = event.data;
            if (!data) return;

            console.log('Received from Brain:', data);

            if (data.event === 'SAY_TEXT') {
                if (data.face) this.setEmotion(data.face);
                if (data.led) this.setLedPattern(data.led.pattern, data.led.color);
                if (data.text) {
                    this.storyText.innerText = data.text;
                    this.speakArabic(data.text);
                }
            } else if (data.event === 'SET_FACE') {
                this.setEmotion(data.face);
            } else if (data.event === 'SET_LED') {
                this.setLedPattern(data.led.pattern, data.led.color);
            } else if (data.event === 'PLAY_GEMINI_AUDIO') {
                if (data.face) this.setEmotion(data.face);
                if (data.led) this.setLedPattern(data.led.pattern, data.led.color || '#00f2fe');
                if (data.text) this.storyText.innerText = data.text;

                if (data.audioUrl) {
                    this.playAudioFile(data.audioUrl, () => {
                        this.setEmotion('happy');
                    }, data.text);
                } else if (data.text) {
                    this.speakArabic(data.text);
                }
            } else if (data.event === 'START_STORY') {
                this.loadLocalDemoStory(data.story_id);
            } else if (data.event === 'BRAIN_HELLO') {
                this.bus.postMessage({ event: 'ROBOT_FACE_ONLINE' });
            }
        };
    }

    init() {
        this.positionLeds();
        this.startFaceLoop();
        this.startLedAnimation();
        this.initAudioContext();
        this.initSpeechRecognition();
        this.setupEvents();
        this.loadLocalDemoStory('space');
        this.tryConnectWebSocket();
    }

    // --- 1. 12 WS2812 LED RING POSITIONING & ANIMATION ---
    positionLeds() {
        // Arrange 12 LEDs circularly around the 310px bezel (radius ~ 138px)
        const radius = 138;
        const centerX = 155; // 310 / 2
        const centerY = 155;

        this.ledElements.forEach((led, idx) => {
            const angle = (idx * 30 - 90) * (Math.PI / 180); // 0 at top
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            led.style.left = `${x}px`;
            led.style.top = `${y}px`;
        });
    }

    setLedPattern(pattern, color = '#00f2fe') {
        this.ledPattern = pattern;
        this.ledColor = color;
    }

    startLedAnimation() {
        if (this.ledInterval) clearInterval(this.ledInterval);
        this.ledInterval = setInterval(() => {
            this.updateLedFrame();
        }, 60);
    }

    updateLedFrame() {
        this.ledStep++;
        const count = 12;

        this.ledElements.forEach((led, i) => {
            let color = '#1a2035';
            let glow = 'none';

            if (this.ledPattern === 'spin') {
                const activeIdx = (this.ledStep) % count;
                const trail1 = (this.ledStep - 1 + count) % count;
                const trail2 = (this.ledStep - 2 + count) % count;
                if (i === activeIdx) {
                    color = this.ledColor;
                    glow = `0 0 16px ${this.ledColor}, 0 0 25px ${this.ledColor}`;
                } else if (i === trail1) {
                    color = this.adjustOpacity(this.ledColor, 0.6);
                    glow = `0 0 8px ${this.ledColor}`;
                } else if (i === trail2) {
                    color = this.adjustOpacity(this.ledColor, 0.25);
                }
            } else if (this.ledPattern === 'rainbow') {
                const hue = (this.ledStep * 10 + i * 30) % 360;
                color = `hsl(${hue}, 100%, 55%)`;
                glow = `0 0 12px ${color}`;
            } else if (this.ledPattern === 'pulse') {
                const brightness = (Math.sin(this.ledStep * 0.15) + 1) / 2;
                color = this.adjustOpacity(this.ledColor, 0.2 + brightness * 0.8);
                glow = `0 0 ${12 * brightness}px ${this.ledColor}`;
            } else if (this.ledPattern === 'sparkle') {
                if (Math.random() > 0.65) {
                    color = '#ffffff';
                    glow = `0 0 15px #ffffff`;
                } else {
                    color = this.ledColor;
                    glow = `0 0 8px ${this.ledColor}`;
                }
            } else if (this.ledPattern === 'off') {
                color = '#111524';
                glow = 'none';
            }

            led.style.background = color;
            led.style.boxShadow = glow;
        });
    }

    adjustOpacity(color, opacity) {
        if (color.startsWith('#')) {
            const r = parseInt(color.slice(1, 3), 16) || 0;
            const g = parseInt(color.slice(3, 5), 16) || 242;
            const b = parseInt(color.slice(5, 7), 16) || 254;
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        }
        return color;
    }

    // --- 2. HIGH-PERFORMANCE 60FPS GC9A01 FACE CANVAS ---
    startFaceLoop() {
        const loop = () => {
            this.updateFaceLogic();
            this.drawFace();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    updateFaceLogic() {
        const now = Date.now();
        // Natural Blinking Cycle
        if (!this.isBlinking && (now - this.lastBlinkTime > this.blinkInterval)) {
            this.isBlinking = true;
            this.blinkProgress = 0;
            this.blinkInterval = 2500 + Math.random() * 3000;
        }

        if (this.isBlinking) {
            this.blinkProgress += 0.14;
            if (this.blinkProgress >= 1) {
                this.isBlinking = false;
                this.blinkProgress = 0;
                this.lastBlinkTime = now;
            }
        }

        // Speaking movement
        if (this.isSpeaking) {
            this.eyeYOffset = Math.sin(now * 0.02) * 3;
        } else {
            this.eyeYOffset = 0;
        }
    }

    drawFace() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, 240, 240);

        // Deep Black circular GC9A01 screen background
        ctx.fillStyle = '#02040a';
        ctx.beginPath();
        ctx.arc(120, 120, 120, 0, Math.PI * 2);
        ctx.fill();

        // Eye Center Positions
        const leftEyeX = 120 - this.eyeSpacing + this.eyeXOffset;
        const rightEyeX = 120 + this.eyeSpacing + this.eyeXOffset;
        const eyeY = 110 + this.eyeYOffset;

        // Render Left and Right Eyes
        this.drawSingleEye(ctx, leftEyeX, eyeY, false);
        this.drawSingleEye(ctx, rightEyeX, eyeY, true);

        // Cute Blush for Happy / Love emotion
        if (this.emotion === 'happy' || this.emotion === 'love') {
            ctx.fillStyle = 'rgba(255, 90, 140, 0.35)';
            ctx.beginPath();
            ctx.arc(leftEyeX - 18, eyeY + 36, 10, 0, Math.PI * 2);
            ctx.arc(rightEyeX + 18, eyeY + 36, 10, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawSingleEye(ctx, x, y, isRight) {
        ctx.save();
        ctx.translate(x, y);

        // Blinking height modifier
        let scaleY = 1;
        if (this.isBlinking) {
            scaleY = Math.max(0.08, 1 - Math.sin(this.blinkProgress * Math.PI));
        }

        ctx.fillStyle = this.eyeColor;
        ctx.shadowColor = this.eyeColor;
        ctx.shadowBlur = 15;

        const w = this.eyeWidth;
        const h = this.eyeHeight * scaleY;
        const r = Math.min(this.eyeRadius, h / 2);

        if (this.emotion === 'happy') {
            // Cute Smiling Crescents (Arch eyes)
            ctx.lineWidth = 10;
            ctx.strokeStyle = this.eyeColor;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(0, 0, 22, Math.PI * 1.15, Math.PI * 1.85, false);
            ctx.stroke();
        } else if (this.emotion === 'wonder') {
            // Wide amazed eyes with sparkle star pupils
            this.drawRoundedRect(ctx, -w / 2, -h / 2, w + 6, h + 8, r + 4);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(isRight ? -4 : 4, -8, 7, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.emotion === 'curious') {
            // One eye raised, one eye slightly squinted
            const currH = isRight ? h * 0.75 : h * 1.15;
            this.drawRoundedRect(ctx, -w / 2, -currH / 2, w, currH, r);
        } else if (this.emotion === 'sleepy') {
            // Relaxed closed lines
            ctx.lineWidth = 6;
            ctx.strokeStyle = this.eyeColor;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-w / 2, 0);
            ctx.lineTo(w / 2, 0);
            ctx.stroke();
        } else if (this.emotion === 'love') {
            // Heart eyes
            this.drawHeart(ctx, 0, 0, 24);
        } else {
            // Default / Listening / Speaking Rounded Capsule Eyes
            this.drawRoundedRect(ctx, -w / 2, -h / 2, w, h, r);

            // Pupil highlight reflection
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.beginPath();
            ctx.arc(isRight ? 6 : -6, -h / 4, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }

    drawHeart(ctx, x, y, size) {
        ctx.beginPath();
        const topCurveHeight = size * 0.3;
        ctx.moveTo(x, y + topCurveHeight);
        // top left curve
        ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + topCurveHeight);
        // bottom left curve
        ctx.bezierCurveTo(x - size / 2, y + (size + topCurveHeight) / 2, x, y + (size + topCurveHeight) / 2, x, y + size);
        // bottom right curve
        ctx.bezierCurveTo(x, y + (size + topCurveHeight) / 2, x + size / 2, y + (size + topCurveHeight) / 2, x + size / 2, y + topCurveHeight);
        // top right curve
        ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + topCurveHeight);
        ctx.closePath();
        ctx.fill();
    }

    setEmotion(emotion) {
        this.emotion = emotion;
        if (emotion === 'happy') {
            this.eyeColor = '#00f2fe';
            this.setLedPattern('spin', '#00f2fe');
        } else if (emotion === 'wonder') {
            this.eyeColor = '#ffcf00';
            this.setLedPattern('rainbow');
        } else if (emotion === 'curious') {
            this.eyeColor = '#a855f7';
            this.setLedPattern('pulse', '#a855f7');
        } else if (emotion === 'listening') {
            this.eyeColor = '#22c55e';
            this.setLedPattern('pulse', '#22c55e');
        } else if (emotion === 'speaking') {
            this.eyeColor = '#00f2fe';
            this.setLedPattern('spin', '#38bdf8');
        } else if (emotion === 'love') {
            this.eyeColor = '#ec4899';
            this.setLedPattern('pulse', '#ec4899');
        } else if (emotion === 'sleepy') {
            this.eyeColor = '#64748b';
            this.setLedPattern('off');
        }
    }

    // --- 3. AUDIO SYNTHESIZER & SFX (Web Audio API) ---
    initAudioContext() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            this.audioCtx = new AudioCtx();
        }
    }

    playCuteBeep(type = 'happy') {
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        const now = this.audioCtx.currentTime;
        if (type === 'touch') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.12);
        } else if (type === 'happy') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(660, now + 0.1);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.2);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
        }
    }

    // --- 4. SPEECH SYNTHESIS (TTS) & RECOGNITION (STT) ---
    playAudioFile(url, onComplete, fallbackText = null) {
        if (this.currentAudio) {
            try {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
            } catch (e) {}
            this.currentAudio = null;
        }

        const audio = new Audio(url);
        this.currentAudio = audio;

        audio.onplay = () => {
            this.isSpeaking = true;
            this.setEmotion('speaking');
        };

        audio.onended = () => {
            this.isSpeaking = false;
            this.setEmotion('happy');
            if (onComplete) onComplete();
        };

        const doFallback = () => {
            this.isSpeaking = false;
            const textToSpeak = fallbackText || this.storyText?.innerText || '';
            console.log('Falling back to speech synthesis for text:', textToSpeak);
            if (textToSpeak) {
                this.speakArabic(textToSpeak, onComplete);
            } else if (onComplete) {
                onComplete();
            }
        };

        audio.onerror = (e) => {
            console.warn('Audio playback error, falling back:', e);
            doFallback();
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(e => {
                console.warn('Audio play restricted or failed, falling back:', e);
                doFallback();
            });
        }
    }

    speakArabic(text, onComplete) {
        if (!this.speechSynth) {
            if (onComplete) onComplete();
            return;
        }

        this.speechSynth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ar-SA';
        utterance.rate = 1.02;  // Natural, responsive conversation pace
        utterance.pitch = 1.22; // Cheerful, warm kid-robot pitch

        // Select Arabic voice if available
        const voices = this.speechSynth.getVoices();
        const arVoice = voices.find(v => v.lang.startsWith('ar'));
        if (arVoice) utterance.voice = arVoice;

        utterance.onstart = () => {
            this.isSpeaking = true;
            this.setEmotion('speaking');
        };

        utterance.onend = () => {
            this.isSpeaking = false;
            this.setEmotion('happy');
            if (onComplete) onComplete();
        };

        utterance.onerror = () => {
            this.isSpeaking = false;
            if (onComplete) onComplete();
        };

        this.speechSynth.speak(utterance);
    }

    initSpeechRecognition() {
        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRec) {
            this.recognition = new SpeechRec();
            this.recognition.lang = 'ar-SA';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;

            this.recognition.onstart = () => {
                this.isListening = true;
                this.micBtn.classList.add('listening');
                this.voiceWave.classList.add('active');
                this.setEmotion('listening');
                this.storyText.innerText = "أنا أسمعك يا بطل... تفضل وتكلم! 👂";
            };

            this.recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                console.log('Child voice transcript:', transcript);
                this.storyText.innerText = `سمعتك تقول: "${transcript}" 🌟`;
                this.onChildSpeechHeard(transcript);
            };

            this.recognition.onend = () => {
                this.isListening = false;
                this.micBtn.classList.remove('listening');
                this.voiceWave.classList.remove('active');
            };

            this.recognition.onerror = (err) => {
                console.warn('Speech recognition error:', err);
                this.isListening = false;
                this.micBtn.classList.remove('listening');
                this.voiceWave.classList.remove('active');
            };
        }
    }

    async onChildSpeechHeard(transcript) {
        // Broadcast to Parent Brain Dashboard
        if (this.bus) {
            this.bus.postMessage({ event: 'CHILD_SPOKE', transcript: transcript });
        }

        // If in story mode waiting for voice
        if (this.waitingForAction === 'voice') {
            this.waitingForAction = null;
            this.setEmotion('happy');
            this.playCuteBeep('happy');
            setTimeout(() => {
                this.advanceStory();
            }, 1200);
            return;
        }

        // Full AI Conversational Response with Gemini
        await this.askGeminiAndReply(transcript);
    }

    async getWorkingGeminiModel(apiKey) {
        let cached = localStorage.getItem('kids_robot_active_model');
        if (cached) return cached;

        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (res.ok) {
                const data = await res.json();
                const valid = (data.models || [])
                    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''));

                if (valid.length > 0) {
                    const flash = valid.find(m => m.includes('flash')) || valid[0];
                    localStorage.setItem('kids_robot_active_model', flash);
                    return flash;
                }
            }
        } catch (e) {
            console.warn('Model list query error:', e);
        }
        return 'gemini-1.5-flash';
    }

    async askGeminiAndReply(childText) {
        const apiKey = localStorage.getItem('kids_robot_gemini_key');
        
        // Visual Thinking Mode
        this.setEmotion('curious');
        this.setLedPattern('spin', '#a855f7');
        this.storyText.innerText = `أفكر في إجابة لسؤالك الذكي... 🤔`;
        this.playCuteBeep('happy');

        // Check if API Key exists
        if (!apiKey) {
            setTimeout(() => {
                const reply = `يا بطل، لم يتم إدخال مفتاح الذكاء الاصطناعي في عقل الروبوت بعد!`;
                this.storyText.innerText = reply;
                this.speakArabic(reply);
            }, 800);
            return;
        }

        try {
            const primaryModel = await this.getWorkingGeminiModel(apiKey);
            const candidateModels = [primaryModel, 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-3.8-flash'];
            const uniqueModels = [...new Set(candidateModels)];

            const systemPrompt = localStorage.getItem('kids_robot_gemini_prompt') || 
                "أنت روبوت أطفال ذكي ومرح اسمك 'روبي'. تحدث باللغة العربية الفصحى السهلة والمرحة وبنبرة دافئة كأنك صديق طفولي. أجب على الطفل بجملة واحدة فقط قصيرة ومشوقة جداً ومحفزة.";

            // Universal bulletproof Gemini payload
            const payload = {
                contents: [{
                    parts: [{
                        text: `${systemPrompt}\n\nسؤال الطفل: ${childText}\nإجابتك السريعة والقصيرة للطفل:`
                    }]
                }],
                generationConfig: {
                    maxOutputTokens: 60,
                    temperature: 0.7
                }
            };

            let textReply = '';
            let successfulModel = '';

            for (const modelName of uniqueModels) {
                try {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (res.ok) {
                        const data = await res.json();
                        textReply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                        if (textReply) {
                            successfulModel = modelName;
                            localStorage.setItem('kids_robot_active_model', modelName);
                            break;
                        }
                    } else {
                        const err = await res.json().catch(() => ({}));
                        console.warn(`Model ${modelName} failed (${res.status}):`, err?.error?.message);
                    }
                } catch (err) {
                    console.warn(`Request failed for ${modelName}:`, err);
                }
            }

            if (!textReply) {
                throw new Error('لم يرجع أي من نماذج Gemini إجابة، يرجى التأكد من صلاحية المفتاح');
            }

            console.log(`Success with Gemini model (${successfulModel}):`, textReply);
            this.storyText.innerText = textReply;
            this.setEmotion('happy');

            // Zero-latency instant local voice synthesis
            this.speakArabic(textReply, () => {
                this.setEmotion('happy');
                this.storyText.innerText = "اضغط (تحدث معي) لتسألني أي شيء آخر! 🌟";
            });

            // Log to Parent Dashboard
            if (this.bus) {
                this.bus.postMessage({ 
                    event: 'ROBOT_REPLIED', 
                    reply: textReply,
                    model: successfulModel 
                });
            }
        } catch (e) {
            console.error('Gemini chat error:', e);
            const errorMsg = `عذراً يا بطل، واجهت مشكلة في التفكير: ${e.message}`;
            this.storyText.innerText = errorMsg;
            this.speakArabic("عذراً يا بطل، حاول أن تسألني مرة أخرى!");
            if (this.bus) {
                this.bus.postMessage({ event: 'ROBOT_ERROR', error: e.message });
            }
        }
    }

    toggleMic() {
        if (!this.recognition) {
            alert('خاصية الميكروفون غير مدعومة في هذا المتصفح. يمكنك التفاعل بلمس الرأس أو زر التالي!');
            return;
        }
        if (this.isListening) {
            this.recognition.stop();
        } else {
            this.recognition.start();
        }
    }

    // --- 5. TOUCH SENSOR (TTP223 EMULATION) ---
    handleHeadTouch() {
        // Haptic feedback for mobile
        if (navigator.vibrate) {
            navigator.vibrate([45]);
        }

        // Visual feedback
        const touchPill = document.querySelector('.touch-pill');
        if (touchPill) {
            touchPill.classList.add('active');
            setTimeout(() => touchPill.classList.remove('active'), 250);
        }

        this.playCuteBeep('touch');

        // Notify Brain Bus & WebSocket
        if (this.bus) {
            this.bus.postMessage({ event: 'TOUCH_TRIGGER', timestamp: Date.now() });
        }
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify({ event: 'TOUCH_TRIGGER', timestamp: Date.now() }));
        }

        // Story reaction
        if (this.waitingForAction === 'touch' || !this.currentStory) {
            this.advanceStory();
        } else {
            this.setEmotion('wonder');
            setTimeout(() => this.setEmotion('happy'), 1200);
        }
    }

    // --- 6. INTERACTIVE STORY ENGINE (DIGITAL TWIN) ---
    loadLocalDemoStory(storyKey) {
        const stories = {
            space: [
                {
                    text: "مرحباً يا صديقي البطل! أنا روبوتك الذكي، هل أنت مستعد لرحلة مذهلة في الفضاء؟ 🚀",
                    audio: "audio/space_1.mp3",
                    face: "happy",
                    led: { pattern: "spin", color: "#00f2fe" },
                    action: "touch",
                    hint: "المس رأسي لنشغل المحركات!"
                },
                {
                    text: "رووووعة! لقد انطلقنا إلى الفضاء الخارجي! انظر للنجوم البراقة حولنا... ✨",
                    audio: "audio/space_2.mp3",
                    face: "wonder",
                    led: { pattern: "rainbow" },
                    action: "touch",
                    hint: "المس رأسي لنقترب من كوكب الأحلام"
                },
                {
                    text: "أرى كوكباً سحرياً ملوناً! قل لي بصوتك عبر الميكروفون: ما هو لونك المفضل لنلون به الكوكب؟ 🎨",
                    audio: "audio/space_3.mp3",
                    face: "curious",
                    led: { pattern: "pulse", color: "#a855f7" },
                    action: "voice",
                    hint: "اضغط على زر (تحدث معي) وقل لونك المفضل!"
                },
                {
                    text: "يا له من اختيار ساحر وذوق رفيع! لقد أصبح الكوكب جميلاً بفضلك يا بطل! 🌟",
                    audio: "audio/space_4.mp3",
                    face: "love",
                    led: { pattern: "sparkle", color: "#ec4899" },
                    action: "touch",
                    hint: "المس رأسي لنعود بسلام للأرض"
                },
                {
                    text: "عدنا بسلام إلى الأرض! لقد كنت رائعاً اليوم. أحبك كثيراً وإلى اللقاء في مغامرة قادمة! ❤️",
                    audio: "audio/space_5.mp3",
                    face: "happy",
                    led: { pattern: "pulse", color: "#00ff88" },
                    action: null,
                    hint: "انتهت المغامرة! يمكنك إعادتها متى شئت."
                }
            ],
            animals: [
                {
                    text: "أهلاً بك في الغابة السحرية! اسمع... هناك صوت حيوان لطيف يقترب منا 🦁",
                    audio: "audio/animals_1.mp3",
                    face: "curious",
                    led: { pattern: "spin", color: "#ff9800" },
                    action: "touch",
                    hint: "المس رأسي لنرى من هو الحيوان!"
                },
                {
                    text: "إنه الأسد سيمبا اللطيف! يبتسم لك ويهديك زهرة ذهبية 🌼",
                    audio: "audio/animals_2.mp3",
                    face: "happy",
                    led: { pattern: "pulse", color: "#ffcf00" },
                    action: "touch",
                    hint: "المس رأسي لنكمل الجولة في الغابة"
                },
                {
                    text: "ما هو حيوانك المفضل في الغابة؟ قل لي بصوتك عبر الميكروفون!",
                    audio: "audio/animals_3.mp3",
                    face: "curious",
                    led: { pattern: "pulse", color: "#22c55e" },
                    action: "voice",
                    hint: "اضغط (تحدث معي) وقل اسم حيوانك المفضل"
                },
                {
                    text: "حيوان رائع وذكي مثلك تماماً! الحيوانات كلها سعيدة بوجودك بيننا اليوم 🎉",
                    audio: "audio/animals_4.mp3",
                    face: "wonder",
                    led: { pattern: "rainbow" },
                    action: null,
                    hint: "انتهت قصة الغابة! أحسنت."
                }
            ]
        };

        this.currentStory = stories[storyKey] || stories.space;
        this.storyIndex = 0;
        this.playCurrentStoryChunk();
    }

    playCurrentStoryChunk() {
        if (!this.currentStory || this.storyIndex >= this.currentStory.length) {
            return;
        }

        const chunk = this.currentStory[this.storyIndex];
        this.storyText.innerText = chunk.text;
        this.setEmotion(chunk.face || 'happy');
        
        if (chunk.led) {
            this.setLedPattern(chunk.led.pattern, chunk.led.color || '#00f2fe');
        }

        this.waitingForAction = chunk.action;

        // Play high-quality child-robot MP3 or fallback to speech synthesis
        const onFinish = () => {
            if (chunk.hint) {
                this.storyText.innerText = chunk.hint;
            }
        };

        if (chunk.audio) {
            this.playAudioFile(chunk.audio, onFinish);
        } else {
            this.speakArabic(chunk.text, onFinish);
        }
    }

    advanceStory() {
        if (!this.currentStory) return;
        this.storyIndex++;
        if (this.storyIndex < this.currentStory.length) {
            this.playCurrentStoryChunk();
        } else {
            this.storyIndex = 0;
            this.storyText.innerText = "اكتملت القصة بنجاح! المس رأسي لتبدأ من جديد 🎉";
            this.setEmotion('happy');
            this.setLedPattern('rainbow');
        }
    }

    onChildAnswer(answerText) {
        this.setEmotion('happy');
        this.playCuteBeep('happy');
        setTimeout(() => {
            this.advanceStory();
        }, 1500);
    }

    // --- 7. WEBSOCKET PROTOCOL CLIENT (UNIFIED PROTOCOL) ---
    tryConnectWebSocket() {
        const url = this.serverUrlInput ? (this.serverUrlInput.value || this.serverUrl) : this.serverUrl;
        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.isConnected = true;
                if (this.serverStatusDot) this.serverStatusDot.classList.add('connected');
                if (this.serverStatusText) this.serverStatusText.innerText = 'متصل بالسيرفر (أوامر سحابية)';
                console.log('Connected to Kids-Robot Backend');
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleServerCommand(data);
                } catch (e) {
                    console.error('Invalid command:', e);
                }
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                if (this.serverStatusDot) this.serverStatusDot.classList.remove('connected');
                if (this.serverStatusText) this.serverStatusText.innerText = 'الوضع المستقل (غير متصل)';
            };

            this.ws.onerror = () => {
                this.isConnected = false;
                if (this.serverStatusDot) this.serverStatusDot.classList.remove('connected');
                if (this.serverStatusText) this.serverStatusText.innerText = 'الوضع المستقل (غير متصل)';
            };
        } catch (e) {
            this.isConnected = false;
        }
    }

    handleServerCommand(cmd) {
        // Unified Command Protocol (Identical for Simulator and ESP32-S3)
        if (cmd.face) this.setEmotion(cmd.face);
        if (cmd.led) this.setLedPattern(cmd.led.pattern, cmd.led.color);
        if (cmd.text) {
            this.storyText.innerText = cmd.text;
            this.speakArabic(cmd.text);
        }
        if (cmd.action_required) {
            this.waitingForAction = cmd.action_required;
        }
    }

    // --- 8. UI EVENT HANDLERS ---
    setupEvents() {
        // Head Touch
        if (this.touchZone) {
            this.touchZone.addEventListener('click', () => this.handleHeadTouch());
            this.touchZone.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.handleHeadTouch();
            });
        }

        // Mic Button
        if (this.micBtn) {
            this.micBtn.addEventListener('click', () => this.toggleMic());
        }

        // Next Button
        if (this.nextBtn) {
            this.nextBtn.addEventListener('click', () => this.advanceStory());
        }

        // Optional drawer controls (if present)
        if (this.settingsBtn && this.controlDrawer) {
            this.settingsBtn.addEventListener('click', () => {
                this.controlDrawer.classList.toggle('open');
            });
        }

        if (this.closeDrawerBtn && this.controlDrawer) {
            this.closeDrawerBtn.addEventListener('click', () => {
                this.controlDrawer.classList.remove('open');
            });
        }

        // Reconnect WS button (if present)
        if (this.reconnectBtn) {
            this.reconnectBtn.addEventListener('click', () => {
                this.tryConnectWebSocket();
            });
        }
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    window.robot = new RobotSimulator();
});
