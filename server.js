const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const JWT_SECRET = 'super_secret_jwt_key_change_this_in_production'; 
const ENCRYPTION_KEY = crypto.scryptSync('my_secure_password', 'salt', 32);

// ── GEMINI CONFIG ─────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR);
}

// --- ENCRYPTION UTILITIES (AES-256-GCM) ---
function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return { iv: iv.toString('hex'), data: encrypted, authTag: authTag.toString('hex') };
}

function decrypt(encryptedObj) {
    try {
        const iv = Buffer.from(encryptedObj.iv, 'hex');
        const authTag = Buffer.from(encryptedObj.authTag, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedObj.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (e) {
        console.error("Decryption failed:", e);
        return null;
    }
}

// --- FILE HELPERS ---
function getDataFile(filename) {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveDataFile(filename, data) {
    const filePath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- GEMINI HELPER ---
async function callGemini(prompt, imageParts = [], retries = 2) {
    const parts = [{ text: prompt }, ...imageParts];
    const payload = {
        contents: [{ role: "user", parts }],
        generationConfig: {
            temperature: 0.4,       // lower = more consistent medical responses
            maxOutputTokens: 3000,  // enough for full structured analysis
            topP: 0.9
        }
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(GEMINI_URL, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000   // 30s timeout
            });
            const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Empty response from Gemini");
            return text;
        } catch (err) {
            const status = err.response?.status;
            // Retry on 429 (rate limit) or 503 (overloaded) — wait 2s between retries
            if (attempt < retries && (status === 429 || status === 503)) {
                await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                continue;
            }
            throw err;
        }
    }
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- ROUTES ---

// 1. Auth Routes
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    const users = getDataFile('users.json');
    if (users.find(u => u.email === email)) {
        return res.status(400).json({ message: 'Email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now().toString(), name, email, password: hashedPassword };
    users.push(newUser);
    saveDataFile('users.json', users);
    res.status(201).json({ message: 'User created' });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const users = getDataFile('users.json');
    const user = users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// 2. Children Routes (Encrypted Storage)
app.get('/api/children', authenticateToken, (req, res) => {
    const allChildren = getDataFile('children.json');
    const userChildren = allChildren.filter(c => c.userId === req.user.id);
    const decrypted = userChildren.map(c => {
        const payload = decrypt(c.data);
        return payload ? { ...payload, _id: c._id } : null;
    }).filter(Boolean);
    res.json(decrypted);
});

app.post('/api/children', authenticateToken, (req, res) => {
    const children = getDataFile('children.json');
    const newChildId = 'child_' + Date.now();
    const encryptedData = encrypt(JSON.stringify(req.body));
    children.push({ _id: newChildId, userId: req.user.id, data: encryptedData });
    saveDataFile('children.json', children);
    res.json({ ...req.body, _id: newChildId });
});

// 3. Visits Routes
app.get('/api/visits/child/:childId', authenticateToken, (req, res) => {
    const allVisits = getDataFile('visits.json');
    const visits = allVisits.filter(v => v.childId === req.params.childId);
    res.json(visits.reverse());
});

app.post('/api/visits', authenticateToken, (req, res) => {
    const visits = getDataFile('visits.json');
    const newVisit = { _id: 'visit_' + Date.now(), ...req.body };
    visits.push(newVisit);
    saveDataFile('visits.json', visits);
    res.json(newVisit);
});

app.put('/api/visits/:id', authenticateToken, (req, res) => {
    let visits = getDataFile('visits.json');
    const idx = visits.findIndex(v => v._id === req.params.id);
    if (idx !== -1) {
        visits[idx] = { ...visits[idx], ...req.body };
        saveDataFile('visits.json', visits);
        res.json({ message: 'Updated' });
    } else {
        res.status(404).json({ message: 'Not found' });
    }
});

// 4. Growth Routes
app.get('/api/growth/child/:childId', authenticateToken, (req, res) => {
    const allGrowth = getDataFile('growth.json');
    const records = allGrowth.filter(g => g.childId === req.params.childId);
    res.json(records);
});

app.post('/api/growth', authenticateToken, (req, res) => {
    const growth = getDataFile('growth.json');
    const newRecord = { _id: 'growth_' + Date.now(), ...req.body };
    growth.push(newRecord);
    saveDataFile('growth.json', growth);
    res.json(newRecord);
});

// 5. AI Chat Route — Gemini in Darija + French
app.post('/api/ai/chat', authenticateToken, async (req, res) => {
    const { message, childAge, childName } = req.body;
    const ageInfo  = childAge  ? `عمر الطفل: ${childAge} شهر.` : '';
    const nameInfo = childName ? `اسم الطفل: ${childName}.`    : '';

    const prompt = `[INSTRUCTION STRICTE: جاوب فقط بالدارجة المغربية بالخط العربي. ممنوع تكتب بالعربية الفصحى. استعمل الدارجة كما يهضروها الناس فالمغرب.]

أنت Sihha، مساعد طبي مغربي متخصص في صحة الأطفال. اسمك Sihha وكتجاوب دايما بالدارجة المغربية.

قواعد مهمة:
- الدارجة المغربية فقط (مثال: "واش"، "كيفاش"، "مزيان"، "خدم"، "ولد"، "بنت"، "دار")
- زيد بعض المصطلحات الطبية بالفرنسية بين قوسين إذا احتجت (مثال: حمى (fièvre))
- استعمل وحدات: kg, cm, °C, mg, ml
- كون واضح ومفيد، مع نصيحة عملية
- دايما قل للوالدين يرجعوا للطبيب للقرارات المهمة
${ageInfo} ${nameInfo}

السؤال: ${message}`;

    try {
        const reply = await callGemini(prompt);
        res.json({ reply });
    } catch (error) {
        console.error("Gemini Chat Error:", error.response?.data || error.message);
        res.status(503).json({ reply: "معذرة، ما قادرش نتواصل مع المساعد الذكي دابا. عاود حاول من بعد." });
    }
});


// 6. AI Treatment Analysis Route — Gemini in Darija + French + Photo analysis
app.post('/api/ai/treatment', authenticateToken, async (req, res) => {
    const { diagnosis, medication, dosage, duration, feedback, photos } = req.body;

    const imageParts = [];
    if (photos && photos.length > 0) {
        for (const photo of photos.slice(0, 3)) {
            const match = photo.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-\+\.]+);base64,(.+)$/);
            if (match) {
                imageParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        }
    }

    const workedMap = {
        'yes':       'نعم، الدواء خدم مزيان وشافى الطفل',
        'partially': 'خدم شوية بصح ما كملش (amélioration partielle)',
        'no':        'ما خدمش بتاتاً (aucune amélioration)'
    };

    const imgNote = imageParts.length > 0
        ? '🖼️ كاينة صور طبية (وصفة أو نتائج تحاليل) — حللها وضمنها في تحليلك.'
        : '';

    // Build a context-aware doctor verdict based on outcome
    const worked = feedback?.worked;
    const verdictInstruction = worked === 'yes'
        ? `الدواء خدم — شرح للوالدين بالتفصيل علاش خدم: ربط التشخيص بالدواء (مثلاً: "هاد الدواء هو المناسب لهاد النوع من التشخيص لأن..."). شرح الميكانيزم بكلمات بسيطة. قيّم الجرعة ومدة العلاج.`
        : worked === 'no'
        ? `الدواء ما خدمش — كطبيب حقيقي، حلل الأسباب الممكنة بالتفصيل: (1) هل التشخيص كان صحيح؟ (2) هل الدواء مناسب لهاد التشخيص؟ (3) هل الجرعة كانت كافية؟ (4) هل المدة كانت كافية؟ (5) هل ممكن يكون كاين مقاومة للدواء (résistance)؟ أعطي أسباب طبية حقيقية ومحتملة.`
        : `الدواء خدم جزئياً — شرح علاش التحسن ما كانش كامل: ممكن الجرعة ناقصة، أو مدة العلاج قصيرة، أو التشخيص محتاج مراجعة، أو كاين عامل ثاني. قدم تفسيرات طبية واضحة.`;

    const prompt = [
        '[INSTRUCTION STRICTE: جاوب فقط بالدارجة المغربية بالخط العربي. ممنوع الفصحى. تكلم كطبيب حقيقي يشرح لوالدين مغاربة.]',
        '',
        'أنت Dr. Sihha، طبيب أطفال مغربي متخصص بخبرة 15 سنة. راك كتشوف هاد الملف الطبي وخصك تعطي رأيك الطبي الحقيقي — مع أسباب واضحة ومنطقية كما يدير الطبيب مع الوالدين.',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━',
        '📋 الملف الطبي:',
        `• التشخيص: ${diagnosis || 'غير محدد'}`,
        `• الدواء: ${medication || 'غير محدد'}`,
        `• الجرعة: ${dosage || 'غير محددة'}`,
        `• مدة العلاج: ${duration ? duration + ' يام' : 'غير محددة'}`,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        '📊 ما لاحظه الوالدين:',
        `• النتيجة: ${workedMap[worked] || 'غير محدد'}`,
        `• التحسن الملاحظ: ${feedback?.improvement || 'ما كتبوا والو'}`,
        `• الآثار الجانبية: ${feedback?.sideEffects || 'لا شيء'}`,
        `• مدة التحسن: ${feedback?.daysToImprove ? feedback.daysToImprove + ' أيام' : 'ما ذكروش'}`,
        '━━━━━━━━━━━━━━━━━━━━━━━',
        imgNote,
        '',
        `تعليمة خاصة: ${verdictInstruction}`,
        '',
        'اكتب تقريرك الطبي بهاد الترتيب:',
        '',
        '**1. 🔬 واش الدواء مناسب للتشخيص؟**',
        'رأيك الطبي: هل هاد الدواء هو الاختيار الصحيح لهاد التشخيص؟ علاش نعم أو علاش لا؟ اشرح بكلمات بسيطة كيفاش كيخدم هاد الدواء على الجسم.',
        '',
        `**2. ${worked === 'yes' ? '✅ علاش خدم مزيان' : worked === 'no' ? '❌ علاش ما خدمش' : '⚠️ علاش خدم بصح ما كملش'}**`,
        'أعطي 2 أو 3 أسباب طبية حقيقية ومحددة — مش عامة. ربط الأسباب بالمعطيات اللي عندك (التشخيص، الجرعة، المدة، التحسن الملاحظ).',
        '',
        '**3. 💊 تقييم الجرعة والمدة**',
        'واش الجرعة كانت مناسبة لعمر/وزن الطفل؟ واش المدة كانت كافية؟ استعمل mg/kg إذا ممكن.',
        '',
        '**4. ⚠️ آثار جانبية مهمة**',
        'الآثار الجانبية الأكثر شيوعاً لهاد الدواء — خاص الوالدين يكونوا على بالهم منها.',
        '',
        '**5. 💡 شنو دير دابا؟**',
        'توصية عملية وواضحة: واش يكمل نفس العلاج؟ واش يغير الجرعة؟ واش يرجع للطبيب؟ واش يدير فحص إضافي؟',
        '',
        '**6. 🚨 ارجع للطبيب فوراً إذا...**',
        'ذكر 3 أعراض محددة تستلزم زيارة عاجلة للطبيب أو للمستعجلات.',
        '',
        'الأسلوب: واضح، مباشر، طبي بصح مفهوم — كما يشرح طبيب لوالدين مغاربة. الدارجة فقط مع المصطلحات الطبية بالفرنسية بين قوسين.'
    ].join('\n');

    try {
        const analysis = await callGemini(prompt, imageParts);
        res.json({ analysis });
    } catch (error) {
        console.error("Gemini Treatment Error:", error.response?.data || error.message);
        const worked = feedback?.worked;
        let fallback = "📋 **تحليل العلاج**\n\n";
        fallback += `الدواء: **${medication || 'غير محدد'}** — الجرعة: ${dosage || '؟'} — المدة: ${duration || '؟'} يام\n\n`;
        if (worked === 'yes')       fallback += "✅ الحمد لله، الدواء خدم مزيان! التشخيص كان صحيح والعلاج ناجح. كمّل المتابعة وتأكد من إتمام الجرعة الكاملة.";
        else if (worked === 'no')   fallback += "❌ الدواء ما خدمش. ممكن التشخيص يحتاج مراجعة، أو الجرعة ما كانتش مناسبة. لازم ترجع للطبيب باش يغير البروتوكول.";
        else                        fallback += "⚠️ كاين تحسن جزئي. كمّل متابعة الطفل وارجع للطبيب إذا ما تحسنش خلال يومين.";
        res.status(503).json({ analysis: fallback });
    }
});

app.listen(PORT, () => {
    console.log(`SihhaChild Server (Gemini Edition) running at http://localhost:${PORT}`);
    console.log(`Data stored in: ${DATA_DIR}`);
    if (!GEMINI_API_KEY) console.warn(`⚠️  GEMINI_API_KEY not set! Run: export GEMINI_API_KEY="your_key"`);
});