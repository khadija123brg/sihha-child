# 🧒 Sihha Child — Suivi de Santé Pédiatrique

Une application web de suivi de santé pour enfants, permettant aux parents de gérer les profils de leurs enfants, leurs visites médicales, leur croissance, et d'obtenir des conseils grâce à l'intelligence artificielle (Google Gemini).

---

## 🚀 Fonctionnalités

- 👤 **Authentification** — Inscription et connexion sécurisées (mots de passe hachés avec bcrypt)
- 👶 **Gestion des enfants** — Ajout et suivi des profils enfants (données chiffrées)
- 🏥 **Visites médicales** — Enregistrement des consultations (médecin, diagnostic, médicaments, dosage...)
- 📈 **Suivi de croissance** — Historique de poids et taille
- 🤖 **Assistant IA** — Conseils santé personnalisés via Google Gemini AI
- 🔒 **Sécurité** — Chiffrement AES des données sensibles des enfants

---

## 🛠️ Technologies utilisées

| Technologie | Rôle |
|---|---|
| Node.js | Serveur backend |
| Express.js | Framework web |
| Google Gemini AI | Assistant intelligent |
| bcrypt | Hachage des mots de passe |
| AES Encryption | Chiffrement des données enfants |
| JSON (fichiers) | Stockage des données |
| HTML / CSS / JS | Interface frontend |

---

## 📁 Structure du projet

```
sihha-child-final/
├── server.js           # Serveur principal (API + routes)
├── public/             # Interface frontend (HTML, CSS, JS)
│   ├── index.html
│   ├── logo.png
│   └── ...
├── data/               # Base de données JSON
│   ├── users.json      # Comptes utilisateurs
│   ├── children.json   # Profils des enfants (chiffrés)
│   ├── visits.json     # Visites médicales
│   └── growth.json     # Données de croissance
├── .env                # Variables d'environnement (non partagé)
└── package.json        # Dépendances du projet
```

---

## ⚙️ Installation et lancement

### 1. Cloner le projet

```bash
git clone https://github.com/khadija123brg/sihha-child.git
cd sihha-child
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

Crée un fichier `.env` à la racine du projet :

```env
GEMINI_API_KEY=ta_clé_api_google_gemini
```

> 💡 Pour obtenir une clé API Gemini : [https://makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey)

### 4. Lancer l'application

```bash
node server.js
```

Puis ouvre ton navigateur sur : **http://localhost:3000**

---

## 🔐 Sécurité

- Les mots de passe sont hachés avec **bcrypt**
- Les données personnelles des enfants sont chiffrées avec **AES-256**
- Le fichier `.env` contenant la clé API ne doit **jamais** être partagé

---

## 👩‍💻 Auteur

Développé par **Khadija** — [github.com/khadija123brg](https://github.com/khadija123brg)
