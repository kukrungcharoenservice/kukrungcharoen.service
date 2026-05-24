require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

let products = [
  { id:1, name:'ชุดซ่อมเครื่องยนต์', brand:'Toyota/Corolla', price:2850, stock:15, category:'เครื่องยนต์', status:'active', sold:42 },
  { id:2, name:'ลูกหมากปีกนกบน',    brand:'ทุกยี่ห้อ',      price:380,  stock:88, category:'ช่วงล่าง',   status:'active', sold:128 },
  { id:3, name:'ไฟหน้า LED H4',      brand:'Universal',      price:650,  stock:34, category:'ไฟ & ไฟฟ้า', status:'active', sold:67 },
  { id:4, name:'คอมแอร์ Denso',      brand:'Denso',          price:7500, stock:6,  category:'แอร์',       status:'active', sold:18 },
  { id:5, name:'ผ้าเบรกหน้า Bendix', brand:'Bendix',         price:890,  stock:52, category:'เบรก',       status:'active', sold:95 },
  { id:6, name:'น้ำมันเครื่อง 10W-30',brand:'Castrol',       price:750,  stock:120,category:'น้ำมัน',     status:'active', sold:210 },
  { id:7, name:'สายพานไทม์มิ่ง',     brand:'Toyota',         price:1200, stock:23, category:'เครื่องยนต์',status:'active', sold:44 },
  { id:8, name:'แบตเตอรี่ GS 55Ah',  brand:'GS Battery',     price:1850, stock:19, category:'ไฟฟ้า',      status:'active', sold:76 },
];

let orders = [
  { id:'KRC-10001', customer:'สมชาย ใจดี',    phone:'081-xxx-xxxx', total:2850, status:'pending',   items:['ชุดซ่อมเครื่องยนต์'], date:'2026-05-24', payment:'โอน' },
  { id:'KRC-10002', customer:'วิภา รักดี',     phone:'089-xxx-xxxx', total:1640, status:'paid',      items:['ผ้าเบรกหน้า x2','ไฟหน้า LED'], date:'2026-05-24', payment:'บัตร' },
  { id:'KRC-10003', customer:'นคร สุขใจ',     phone:'086-xxx-xxxx', total:7500, status:'shipping',  items:['คอมแอร์ Denso'], date:'2026-05-23', payment:'โอน' },
  { id:'KRC-10004', customer:'มาลี ชื่นบาน',  phone:'082-xxx-xxxx', total:750,  status:'delivered', items:['น้ำมันเครื่อง'], date:'2026-05-23', payment:'โอน' },
  { id:'KRC-10005', customer:'ประเสริฐ ดีงาม', phone:'091-xxx-xxxx', total:3700, status:'paid',      items:['แบตเตอรี่ GS','ลูกหมาก x5'], date:'2026-05-22', payment:'PayPal' },
];

let nextProductId = 9;
let nextOrderId = 10006;

app.get('/', (req, res) => res.json({ status:'ok', message:'KRC Auto Parts API' }));

app.get('/api/admin/stats', (req, res) => {
  const totalRevenue = orders.filter(o=>o.status!=='pending').reduce((s,o)=>s+o.total,0);
  res.json({
    totalRevenue,
    totalOrders: orders.length,
    pendingOrders: orders.filter(o=>o.status==='pending').length,
    totalProducts: products.length,
    lowStock: products.filter(p=>p.stock<10).length,
    topProducts: [...products].sort((a,b)=>b.sold-a.sold).slice(0,5)
  });
});

app.get('/api/products', (req, res) => res.json(products));
app.post('/api/products', (req, res) => {
  const p = { id:nextProductId++, sold:0, status:'active', ...req.body };
  products.push(p); res.json(p);
});
app.put('/api/products/:id', (req, res) => {
  const idx = products.findIndex(p=>p.id===parseInt(req.params.id));
  if(idx===-1) return res.status(404).json({error:'Not found'});
  products[idx] = { ...products[idx], ...req.body }; res.json(products[idx]);
});
app.delete('/api/products/:id', (req, res) => {
  products = products.filter(p=>p.id!==parseInt(req.params.id)); res.json({success:true});
});

app.get('/api/orders', (req, res) => res.json(orders));
app.put('/api/orders/:id/status', (req, res) => {
  const order = orders.find(o=>o.id===req.params.id);
  if(!order) return res.status(404).json({error:'Not found'});
  order.status = req.body.status; res.json(order);
});
app.post('/api/orders', (req, res) => {
  const order = { id:`KRC-${nextOrderId++}`, date:new Date().toISOString().split('T')[0], status:'pending', ...req.body };
  orders.unshift(order); res.json(order);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`KRC API running on port ${PORT}`));
