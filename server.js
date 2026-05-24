require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('krc_autoparts');
  console.log('✅ MongoDB connected!');

  // สร้างหมวดหมู่เริ่มต้น
  const catCount = await db.collection('categories').countDocuments();
  if (catCount === 0) {
    await db.collection('categories').insertMany([
      { name:'เครื่องยนต์', icon:'🔧', order:1 },
      { name:'ช่วงล่าง',   icon:'🛞', order:2 },
      { name:'ไฟ & ไฟฟ้า', icon:'💡', order:3 },
      { name:'แอร์ & หม้อน้ำ', icon:'❄️', order:4 },
      { name:'เบรก & คลัทช์', icon:'🔩', order:5 },
      { name:'น้ำมัน & ฟิลเตอร์', icon:'🛢️', order:6 },
    ]);
    console.log('✅ Categories created');
  }
}

app.get('/', (req, res) => res.json({ status:'ok', message:'KRC Auto Parts API 🚗' }));

// ─── STATS ─────────────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [products, orders, categories] = await Promise.all([
      db.collection('products').find().toArray(),
      db.collection('orders').find().toArray(),
      db.collection('categories').find().toArray(),
    ]);
    const totalRevenue = orders.filter(o=>o.status!=='pending').reduce((s,o)=>s+o.total,0);
    const topProducts = [...products].sort((a,b)=>(b.sold||0)-(a.sold||0)).slice(0,5);

    // นับสินค้าแต่ละหมวด
    const catStats = categories.map(c => ({
      ...c,
      count: products.filter(p=>p.category===c.name).length
    }));

    res.json({
      totalRevenue, totalOrders: orders.length,
      pendingOrders: orders.filter(o=>o.status==='pending').length,
      totalProducts: products.length,
      lowStock: products.filter(p=>p.stock<10).length,
      topProducts, categories: catStats
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CATEGORIES ────────────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await db.collection('categories').find().sort({order:1}).toArray();
    const products = await db.collection('products').find().toArray();
    const result = categories.map(c => ({
      ...c, id: c._id,
      count: products.filter(p=>p.category===c.name).length
    }));
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/categories', async (req, res) => {
  try {
    const count = await db.collection('categories').countDocuments();
    const cat = { order: count+1, ...req.body };
    const result = await db.collection('categories').insertOne(cat);
    res.json({ ...cat, id: result.insertedId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    await db.collection('categories').updateOne(
      { _id: new ObjectId(req.params.id) }, { $set: req.body }
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await db.collection('categories').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── PRODUCTS ──────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.status) filter.status = req.query.status;
    const products = await db.collection('products').find(filter).toArray();
    res.json(products.map(p => ({ ...p, id: p._id })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const p = { sold:0, status:'active', createdAt: new Date(), ...req.body };
    const result = await db.collection('products').insertOne(p);
    res.json({ ...p, id: result.insertedId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    await db.collection('products').updateOne(
      { _id: new ObjectId(req.params.id) }, { $set: req.body }
    );
    const updated = await db.collection('products').findOne({ _id: new ObjectId(req.params.id) });
    res.json({ ...updated, id: updated._id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await db.collection('products').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ORDERS ────────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await db.collection('orders').find().sort({ createdAt:-1 }).toArray();
    res.json(orders.map(o => ({ ...o, id: o.orderId || o._id })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const count = await db.collection('orders').countDocuments();
    const orderId = `KRC-${10001 + count}`;
    const order = { orderId, createdAt: new Date(), status:'pending', date: new Date().toISOString().split('T')[0], ...req.body };
    await db.collection('orders').insertOne(order);
    res.json({ ...order, id: orderId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    await db.collection('orders').updateOne(
      { orderId: req.params.id }, { $set: { status: req.body.status } }
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚗 KRC API running on port ${PORT}`));
}).catch(err => { console.error('MongoDB connection failed:', err); process.exit(1); });
