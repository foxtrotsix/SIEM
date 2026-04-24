const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// Database Initialization
const db = new Database('database.db');
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )
`);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration
app.use(session({
    secret: 'gourmethub-secret-key', // In a real app, use an environment variable
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        secure: false // Set to true if using HTTPS
    }
}));

// Auth Middleware
const redirectLogin = (req, res, next) => {
    if (!req.session.userId) {
        res.redirect('/login.html');
    } else {
        next();
    }
};

// Routes
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// Registration API
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    // Basic XSS Prevention: Disallow tags in username
    if (/<[^>]*>/g.test(username)) {
        return res.status(400).json({ success: false, message: 'Invalid characters in username' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const insert = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
        insert.run(username, hashedPassword);
        res.json({ success: true, message: 'Registration successful. Please login.' });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ success: false, message: 'Username already taken' });
        } else {
            res.status(500).json({ success: false, message: 'Error creating user' });
        }
    }
});

// Login API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            req.session.username = user.username;
            res.json({ success: true, message: 'Login successful', username: user.username });
        } else {
            res.status(401).json({ success: false, message: 'Invalid username or password' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Login error' });
    }
});

// Session Check API
app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

// Logout API
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// Local Data for Meals
const mealsData = {
    'Burger': [
        { idMeal: 'b1', strMeal: 'Gourmet Wagyu Burger', strMealThumb: 'img/burger.png', price: 24.99 },
        { idMeal: 'b2', strMeal: 'Classic Truffle Burger', strMealThumb: 'img/burger.png', price: 19.99 }
    ],
    'Pizza': [
        { idMeal: 'p1', strMeal: 'Artisan Margherita', strMealThumb: 'img/pizza.png', price: 18.50 },
        { idMeal: 'p2', strMeal: 'Truffle Mushroom Pizza', strMealThumb: 'img/pizza.png', price: 21.00 }
    ],
    'Sushi': [
        { idMeal: 's1', strMeal: 'Premium Sashimi Platter', strMealThumb: 'img/sushi.png', price: 35.00 },
        { idMeal: 's2', strMeal: 'Dragon Roll Special', strMealThumb: 'img/sushi.png', price: 22.00 }
    ],
    'Pasta': [
        { idMeal: 'a1', strMeal: 'Classic Bolognese', strMealThumb: 'img/pasta.png', price: 17.00 },
        { idMeal: 'a2', strMeal: 'Truffle Carbonara', strMealThumb: 'img/pasta.png', price: 19.50 }
    ]
};

const categoriesData = [
    { strCategory: 'Burger' },
    { strCategory: 'Pizza' },
    { strCategory: 'Sushi' },
    { strCategory: 'Pasta' }
];

// Local Meals API
app.get('/api/categories', (req, res) => {
    res.json({ categories: categoriesData });
});

app.get('/api/meals', (req, res) => {
    const category = req.query.c || 'Burger';
    const meals = mealsData[category] || [];
    res.json({ meals });
});

// Simple Order Submission Logic
app.post('/api/order', redirectLogin, (req, res) => {
    const { cart, paymentInfo } = req.body;
    console.log('Order received:', { cart, paymentInfo, user: req.session.username });
    res.json({ success: true, message: 'Order placed successfully!', orderId: Math.floor(Math.random() * 100000) });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
