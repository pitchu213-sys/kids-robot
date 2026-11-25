/**
 * Kids Robot - Shared Q&A Matching & AI Modular Voice Composer Engine
 * Used by both Robot Face (robot.js) and Parent Brain (brain.js).
 */
(function (root) {
    'use strict';

    const STOP_WORDS = ['يا', 'في', 'من', 'على', 'هل', 'هو', 'هي', 'مع', 'و', 'ان', 'ما', 'عن'];
    const VALID_EMOTIONS = new Set(['happy', 'wonder', 'curious', 'love', 'sleepy']);

    /**
     * Normalizes Arabic text for dialect-tolerant matching (removes tashkeel, normalizes alef/taa/yaa).
     */
    function normalizeArabic(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .replace(/[\u064B-\u065F\u0670]/g, '')
            .replace(/[إأآا]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/ؤ|ئ/g, 'ء')
            .replace(/[؟?.,!،؛:()_"'-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Scores and selects the highest-confidence Tier 1 pre-recorded full Q&A entry.
     */
    function findMatchingQA(qaLibrary, transcript) {
        if (!qaLibrary || !qaLibrary.length) return null;
        const normInput = normalizeArabic(transcript);
        if (!normInput) return null;

        const inputWords = normInput.split(' ').filter(w => w.length > 1 && !STOP_WORDS.includes(w));
        let bestItem = null;
        let highestScore = 0;

        for (const item of qaLibrary) {
            let score = 0;
            const normTitle = normalizeArabic(item.title || '');
            const normCat = normalizeArabic(item.category || '');

            if (normInput === normTitle) score += 1000;
            if (normInput === normCat) score += 800;

            if (normTitle && (normInput.includes(normTitle) || (normInput.length >= 4 && normTitle.includes(normInput)))) {
                score += 400;
            }
            if (normCat && (normInput.includes(normCat) || (normInput.length >= 4 && normCat.includes(normInput)))) {
                score += 300;
            }

            const metaWords = (normTitle + ' ' + normCat).split(' ').filter(w => w.length > 2 && !STOP_WORDS.includes(w));
            for (const w of inputWords) {
                if (metaWords.includes(w)) score += 150;
            }

            if (item.triggers) {
                for (const trig of item.triggers) {
                    const normTrig = normalizeArabic(trig);
                    if (!normTrig) continue;

                    if (normInput === normTrig) {
                        score += 1000;
                    } else if (normInput.includes(normTrig)) {
                        score += 500 + normTrig.length * 5;
                    } else if (normTrig.includes(normInput) && normInput.length >= 3) {
                        score += 250 + normInput.length * 5;
                    } else {
                        const trigWords = normTrig.split(' ').filter(w => w.length > 1 && !STOP_WORDS.includes(w));
                        let matchedWords = 0;
                        for (const tw of trigWords) {
                            if (inputWords.includes(tw)) matchedWords++;
                        }
                        if (matchedWords > 0 && trigWords.length > 0) {
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

    /**
     * Builds a compact prompt instructing Gemini to compose replies out of modular Voice Blocks.
     */
    function buildComposerPrompt(voiceBlocks, childText, childProfile, customSystemPrompt) {
        const blocksCatalog = (voiceBlocks || [])
            .map(b => {
                const purpose = b.description ? `\nملاءمة اللبنة: ${b.description}` : '';
                return `${b.id} [${b.role_ar || b.role}; الشعور: ${b.emotion}]${purpose}\nالنص المسجل: ${b.text}`;
            })
            .join('\n\n');

        let profileHint = '';
        if (childProfile && (childProfile.name || childProfile.interests || childProfile.notes)) {
            profileHint = `\nبيانات الطفل: الاسم="${childProfile.name || 'صديقي'}", العمر=${childProfile.age || 5}, الاهتمامات="${childProfile.interests || ''}", ملاحظات الأهل="${childProfile.notes || ''}".`;
        }

        const persona = customSystemPrompt ||
            "أنت عقل روبوت أطفال ودود اسمك 'روبي'. تفهم الدارجة التونسية والعربية الفصحى بطلاقة.";

        return `${persona}${profileHint}

لديك مكتبة من اللبنات الصوتية القصيرة (Voice Blocks) المسجلة بأحاسيس مختلفة:
${blocksCatalog}

تعليمات اختيار الرد (أرجع JSON صالحاً فقط بدون أي نص إضافي):
افهم معنى كلام الطفل وسياق المحادثة، ثم اقرأ وصف كل لبنة لتقرر مدى ملاءمتها. لا تختر لبنة لمجرد تشابه كلمة، ولا تفرض افتتاحية أو خاتمة إذا لم تضف معنى.

1) إذا كانت لبنة واحدة أو لبنتان تجيبان عن الطفل أو تتفاعلان معه بوضوح، أرجع:
{"mode":"blocks","ids":["id1","id2"]}

2) إذا كان السؤال يحتاج معلومة جديدة غير موجودة في النصوص المسجلة، اختر bridge_smart_q فقط إذا كانت تمهيداً مناسباً، واكتب جواباً قصيراً ودقيقاً، أرجع:
{"mode":"hybrid","opener_id":"bridge_smart_q","text":"جواب مناسب للطفل","emotion":"wonder"}

3) إذا لم تلائم أي لبنة معنى كلام الطفل، لا تجبر الاختيار؛ أرجع رداً طبيعياً قصيراً:
{"mode":"text","text":"رد طبيعي مناسب للطفل","emotion":"happy"}

كلام الطفل الآن: "${childText}"`;
    }

    /**
     * Parses Gemini's response into playable steps backed by voiceBlocks.
     */
    function parseComposerReply(rawText, voiceBlocks) {
        const blockMap = new Map((voiceBlocks || []).map(b => [b.id, b]));
        const trimmed = (rawText || '').trim();

        const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);

                if (parsed.mode === 'blocks' && Array.isArray(parsed.ids)) {
                    const steps = parsed.ids
                        .slice(0, 4)
                        .map(id => blockMap.get(id))
                        .filter(Boolean);
                    if (steps.length > 0) {
                        return { mode: 'blocks', steps: steps };
                    }
                }

                if ((parsed.mode === 'hybrid' || parsed.mode === 'text') && parsed.text) {
                    const steps = [];
                    if (parsed.mode === 'hybrid') {
                        const opener = blockMap.get(parsed.opener_id);
                        if (opener) steps.push(opener);
                    }
                    const safeEmotion = VALID_EMOTIONS.has(parsed.emotion) ? parsed.emotion : 'happy';
                    steps.push({
                        id: parsed.mode === 'hybrid' ? 'dynamic_answer' : 'dynamic_text',
                        role: 'dynamic',
                        emotion: safeEmotion,
                        led: parsed.mode === 'hybrid'
                            ? { pattern: 'sparkle', color: '#00f2fe' }
                            : { pattern: 'pulse', color: '#00f2fe' },
                        text: String(parsed.text).trim(),
                        audio: null,
                        recorded: false
                    });
                    return { mode: parsed.mode, steps: steps };
                }
            } catch (e) {
                // Fall through to plain-text fallback
            }
        }

        // Plain text fallback if model returned regular text instead of JSON
        const cleanText = trimmed.replace(/```json|```/gi, '').trim();
        return {
            mode: 'text',
            steps: [{
                id: 'dynamic_text',
                role: 'dynamic',
                emotion: 'happy',
                led: { pattern: 'spin', color: '#00f2fe' },
                text: cleanText,
                audio: null,
                recorded: false
            }]
        };
    }

    const api = {
        normalizeArabic: normalizeArabic,
        findMatchingQA: findMatchingQA,
        buildComposerPrompt: buildComposerPrompt,
        parseComposerReply: parseComposerReply
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.KidsRobotQA = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
