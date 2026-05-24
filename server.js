require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── MongoDB Connection ────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('krc_autoparts');
  console.log('✅ MongoDB connected!');

  // สร้างข้อมูลเริ่มต้นถ้ายังไม่มี
  const count = await db.collection('products').countDocuments();
  if (count === 0) {
    await db.collection('products').insertMany([
      { name:'ชุดซ่อมเครื่องยนต์', brand:'Toyota/Corolla', price:2850, stock:15, category:'เครื่องยนต์', status:'active', sold:0 },
      { name:'ลูกหมากปีกนกบน',    brand:'ทุกยี่ห้อ',      price:380,  stock:88, category:'ช่วงล่าง',    status:'active', sold:0 },
      { name:'ไฟหน้า LED H4',      brand:'Universal',      price:650,  stock:34, category:'ไฟ & ไฟฟ้า',  status:'active', sold:0 },
      { name:'คอมแอร์ Denso',      brand:'Denso',          price:7500, stock:6,  category:'แอร์',        status:'active', sold:0 },
      { name:'ผ้าเบรกหน้า Bendix', brand:'Bendix',         price:890,  stock:52, category:'เบรก',        status:'active', sold:0 },
      { name:'น้ำมันเครื่อง 10W-30',brand:'Castrol',       price:750,  stock:120,category:'น้ำมัน',      status:'active', sold:0 },
      { name:'สายพานไทม์มิ่ง',     brand:'Toyota',         price:1200, stock:23, category:'เครื่องยนต์', status:'active', sold:0 },
      { name:'แบตเตอรี่ GS 55Ah',  brand:'GS Battery',     price:1850, stock:19, category:'ไฟฟ้า',       status:'active', sold:0 },
    ]);
    console.log('✅ Initial products created');
  }
}

// ─── Health ────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status:'ok', message:'KRC Auto Parts API 🚗' }));

// ─── STATS ─────────────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [products, orders] = await Promise.all([
      db.collection('products').find().toArray(),
      db.collection('orders').find().toArray(),
    ]);
    const totalRevenue = orders.filter(o=>o.status!=='pending').reduce((s,o)=>s+o.total,0);
    const topProducts = [...products].sort((a,b)=>(b.sold||0)-(a.sold||0)).slice(0,5);
    res.json({
      totalRevenue,
      totalOrders: orders.length,
      pendingOrders: orders.filter(o=>o.status==='pending').length,
      totalProducts: products.length,
      lowStock: products.filter(p=>p.stock<10).length,
      topProducts,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── PRODUCTS ──────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const products = await db.collection('products').find().toArray();
    res.json(products.map(p => ({ ...p, id: p._id })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const result = await db.collection('products').insertOne({ sold:0, status:'active', ...req.body });
    res.json({ ...req.body, id: result.insertedId, _id: result.insertedId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    await db.collection('products').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
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
    const orders = await db.collection('orders').find().sort({ date:-1 }).toArray();
    res.json(orders.map(o => ({ ...o, id: o.orderId || o._id })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const count = await db.collection('orders').countDocuments();
    const orderId = `KRC-${10001 + count}`;
    const order = {
      orderId,
      date: new Date().toISOString().split('T')[0],
      status: 'pending',
      ...req.body
    };
    await db.collection('orders').insertOne(order);
    res.json({ ...order, id: orderId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    await db.collection('orders').updateOne(
      { orderId: req.params.id },
      { $set: { status: req.body.status } }
    );
    res.json({ success: true, status: req.body.status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚗 KRC API running on port ${PORT}`));
}).catch(err => {
  console.error('MongoDB connection failed:', err);
  process.exit(1);
});
