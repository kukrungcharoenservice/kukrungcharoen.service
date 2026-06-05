require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;
let db;

function toObjectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

function getInventory(p) {
  return p.inventory || {
    available: Number(p.stock || 0),
    reserved: 0,
    sold: Number(p.sold || 0),
    incoming: 0,
    damaged: 0
  };
}

function getAvailableStock(p) {
  return getInventory(p).available || 0;
}

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('krc_autoparts');
  console.log('✅ MongoDB connected!');

  const catCount = await db.collection('categories').countDocuments();
  if (catCount === 0) {
    await db.collection('categories').insertMany([
      { name:'เครื่องยนต์', icon:'🔧', order:1 },
      { name:'ช่วงล่าง', icon:'🛞', order:2 },
      { name:'ไฟ & ไฟฟ้า', icon:'💡', order:3 },
      { name:'แอร์ & หม้อน้ำ', icon:'❄️', order:4 },
      { name:'เบรก & คลัทช์', icon:'🔩', order:5 },
      { name:'น้ำมัน & ฟิลเตอร์', icon:'🛢️', order:6 },
    ]);
    console.log('✅ Categories created');
  }
}

app.get('/', (req, res) => {
  res.json({ status:'ok', message:'KRC Auto Parts API 🚗' });
});

// ─── STATS ─────────────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [products, orders, categories] = await Promise.all([
      db.collection('products').find().toArray(),
      db.collection('orders').find().toArray(),
      db.collection('categories').find().toArray(),
    ]);

    const totalRevenue = orders
      .filter(o => o.status !== 'pending' && o.status !== 'cancelled')
      .reduce((s, o) => s + Number(o.total || 0), 0);

    const topProducts = [...products]
      .sort((a, b) => (b.sold || 0) - (a.sold || 0))
      .slice(0, 5)
      .map(p => ({
        ...p,
        id: p._id,
        stock: getAvailableStock(p)
      }));

    const catStats = categories.map(c => ({
      ...c,
      count: products.filter(p => p.category === c.name).length
    }));

    res.json({
      totalRevenue,
      totalOrders: orders.length,
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      totalProducts: products.length,
      lowStock: products.filter(p => getAvailableStock(p) < 10).length,
      topProducts,
      categories: catStats
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── CATEGORIES ────────────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await db.collection('categories').find().sort({ order:1 }).toArray();
    const products = await db.collection('products').find().toArray();

    const result = categories.map(c => ({
      ...c,
      id: c._id,
      count: products.filter(p => p.category === c.name).length
    }));

    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const count = await db.collection('categories').countDocuments();
    const cat = { order: count + 1, ...req.body };
    const result = await db.collection('categories').insertOne(cat);
    res.json({ ...cat, id: result.insertedId });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    await db.collection('categories').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await db.collection('categories').deleteOne({
      _id: new ObjectId(req.params.id)
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PRODUCTS ──────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.status) filter.status = req.query.status;

    const products = await db.collection('products').find(filter).toArray();

    res.json(products.map(p => ({
      ...p,
      id: p._id,
      inventory: getInventory(p),
      stock: getAvailableStock(p)
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const stock = Number(req.body.stock || req.body.inventory?.available || 0);

    const p = {
      sold: 0,
      status: 'active',
      createdAt: new Date(),
      ...req.body,
      inventory: req.body.inventory || {
        available: stock,
        reserved: 0,
        sold: 0,
        incoming: 0,
        damaged: 0
      },
      stock: stock
    };

    const result = await db.collection('products').insertOne(p);

    res.json({
      ...p,
      id: result.insertedId
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const productId = new ObjectId(req.params.id);
    const oldProduct = await db.collection('products').findOne({ _id: productId });

    if (!oldProduct) {
      return res.status(404).json({ error: 'ไม่พบสินค้า' });
    }

    const updateData = { ...req.body };

    if (req.body.stock !== undefined) {
      const newStock = Number(req.body.stock || 0);
      const oldInventory = getInventory(oldProduct);

      updateData.inventory = {
        ...oldInventory,
        available: newStock
      };

      updateData.stock = newStock;
    }

    await db.collection('products').updateOne(
      { _id: productId },
      { $set: updateData }
    );

    const updated = await db.collection('products').findOne({ _id: productId });

    res.json({
      ...updated,
      id: updated._id,
      inventory: getInventory(updated),
      stock: getAvailableStock(updated)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await db.collection('products').deleteOne({
      _id: new ObjectId(req.params.id)
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ORDERS ────────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await db.collection('orders').find().sort({ createdAt:-1 }).toArray();

    res.json(orders.map(o => ({
      ...o,
      id: o.orderId || o._id
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const items = req.body.items || [];

    for (const item of items) {
      const productId = item.productId || item._id || item.id;
      const qty = Number(item.qty || item.quantity || 1);
      const objectId = toObjectId(productId);

      if (!objectId) continue;

      const product = await db.collection('products').findOne({ _id: objectId });

      if (!product) {
        return res.status(400).json({ error: `ไม่พบสินค้า ${productId}` });
      }

      const inv = getInventory(product);

      if (inv.available < qty) {
        return res.status(400).json({
          error: `${product.name} สต็อกไม่พอ เหลือ ${inv.available} ชิ้น`
        });
      }

      await db.collection('products').updateOne(
        { _id: objectId },
        {
          $inc: {
            'inventory.available': -qty,
            'inventory.reserved': qty,
            stock: -qty
          }
        }
      );
    }

    const count = await db.collection('orders').countDocuments();
    const orderId = `KRC-${10001 + count}`;

    const order = {
      orderId,
      createdAt: new Date(),
      status: 'pending',
      date: new Date().toISOString().split('T')[0],
      ...req.body
    };

    await db.collection('orders').insertOne(order);

    res.json({
      ...order,
      id: orderId
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const newStatus = req.body.status;

    const order = await db.collection('orders').findOne({
      orderId: req.params.id
    });

    if (!order) {
      return res.status(404).json({ error: 'ไม่พบออเดอร์' });
    }

    const oldStatus = order.status;

    if (oldStatus === newStatus) {
      return res.json({ success: true });
    }

    const items = order.items || [];

    for (const item of items) {
      const productId = item.productId || item._id || item.id;
      const qty = Number(item.qty || item.quantity || 1);
      const objectId = toObjectId(productId);

      if (!objectId) continue;

      const paidStatuses = ['paid', 'shipping', 'delivered'];

      if (oldStatus === 'pending' && paidStatuses.includes(newStatus)) {
        await db.collection('products').updateOne(
          { _id: objectId },
          {
            $inc: {
              'inventory.reserved': -qty,
              'inventory.sold': qty,
              sold: qty
            }
          }
        );
      }

      if (oldStatus === 'pending' && newStatus === 'cancelled') {
        await db.collection('products').updateOne(
          { _id: objectId },
          {
            $inc: {
              'inventory.available': qty,
              'inventory.reserved': -qty,
              stock: qty
            }
          }
        );
      }

      if (paidStatuses.includes(oldStatus) && newStatus === 'cancelled') {
        await db.collection('products').updateOne(
          { _id: objectId },
          {
            $inc: {
              'inventory.available': qty,
              'inventory.sold': -qty,
              sold: -qty,
              stock: qty
            }
          }
        );
      }
    }

    await db.collection('orders').updateOne(
      { orderId: req.params.id },
      {
        $set: {
          status: newStatus,
          updatedAt: new Date()
        }
      }
    );

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── THEME ─────────────────────────────────────────────────────
app.get('/api/theme', async (req, res) => {
  try {
    const theme = await db.collection('settings').findOne({ key: 'theme' });

    if (!theme) return res.json({});

    const { _id, key, ...data } = theme;
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/theme', async (req, res) => {
  try {
    await db.collection('settings').updateOne(
      { key: 'theme' },
      {
        $set: {
          key: 'theme',
          ...req.body,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🚗 KRC API running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  });
