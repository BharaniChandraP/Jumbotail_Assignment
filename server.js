



const express = require('express');
const fs = require('fs');
const Fuse = require('fuse.js');

const app = express();
app.use(express.json());

// 1. LOAD DATA IN-MEMORY
let products = [];
try {
    const data = fs.readFileSync('./scraped_products.json', 'utf8');
    products = JSON.parse(data);
    console.log(`Loaded ${products.length} products into memory.`);
} catch (err) {
    console.error("Error loading products.json. Please run your scraper/generator first.");
    products = [];
}

// 2. CONFIGURE FUZZY SEARCH (Fuse.js)
const fuseOptions = {
    keys: ['title', 'description', 'Metadata.category', 'Metadata.brand'],
    threshold: 0.4, 
    includeScore: true
};
let fuse = new Fuse(products, fuseOptions);

// API 1: STORE PRODUCT
app.post('/api/v1/product', (req, res) => {
    try {
        const newProduct = {
            productid: products.length + 1001,
            ...req.body,
            units_sold: req.body.units_sold || 0,
            rating: req.body.rating || 0,
            stock: req.body.stock || 0
        };
        products.push(newProduct);
        fuse = new Fuse(products, fuseOptions);
        res.status(201).json({ productId: newProduct.productid });
    } catch (error) {
        res.status(400).json({ error: "Invalid product data" });
    }
});

// API 2: UPDATE METADATA
app.put('/api/v1/product/meta-data', (req, res) => {
    const { productid, Metadata } = req.body;
    const product = products.find(p => p.productid === productid);
    
    if (product) {
        product.Metadata = { ...product.Metadata, ...Metadata };
        return res.json({ productId: productid, Metadata: product.Metadata });
    }
    res.status(404).json({ error: "Product not found" });
});

// API 3: SEARCH & RANKING (The Core Engine)
app.get('/api/v1/search/product', (req, res) => {
    try {
        const rawQuery = (req.query.query || "").toLowerCase();
        
        if (!rawQuery) {
            return res.json({ data: [] });
        }

        
        const isSasta = rawQuery.includes("sasta") || rawQuery.includes("cheap") || rawQuery.includes("sastha");
        const isLatest = rawQuery.includes("latest") || rawQuery.includes("new");
        
        
        const cleanQuery = rawQuery.replace(/sasta|cheap|sastha|latest|new/g, "").trim();
        
        
        let searchResults = fuse.search(cleanQuery || rawQuery);

        
        let rankedData = searchResults.map(result => {
            const p = result.item;
            
            
            let score = (1 - result.score) * 100;

            
            score += (p.rating * 15); 
            score += (p.units_sold / 50); 

            
            if (isSasta) {
               
                score += (150000 - p.Sellingprice) / 1000;
            }

            
            if (isLatest) {
                
                score += (p.productid / 100);
            }

            
            if (p.stock > 0) {
                score += 30; 
            } else {
                score -= 50; 
            }

            return { ...p, search_score: parseFloat(score.toFixed(2)) };
        });

        
        rankedData.sort((a, b) => b.search_score - a.search_score);

        res.json({ data: rankedData.slice(0, 20) });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Search engine error" });
    }
});


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Search Microservice Running`);
    console.log(`URL: http://localhost:${PORT}/api/v1/search/product?query=Sasta iPhone`);
});