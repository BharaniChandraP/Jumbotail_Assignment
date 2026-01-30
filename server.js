// const express = require('express');
// const fs = require('fs');
// const app = express();
// app.use(express.json());

// // 1. Load products in-memory [cite: 24]
// let products = JSON.parse(fs.readFileSync('./scraped_products.json', 'utf8'));

// // API 1: Store Product in Catalog [cite: 34, 37]
// app.post('/api/v1/product', (req, res) => {
//     const newProduct = {
//         productid: products.length + 1,
//         ...req.body,
//         units_sold: Math.floor(Math.random() * 1000), // Random popularity for ranking
//         rating: req.body.rating || 4.0
//     };
//     products.push(newProduct);
//     res.status(201).json({ productId: newProduct.productid });
// });

// // API 2: Update Metadata [cite: 53, 56]
// app.put('/api/v1/product/meta-data', (req, res) => {
//     const { productid, Metadata } = req.body;
//     const product = products.find(p => p.productid === productid);
//     if (product) {
//         product.Metadata = { ...product.Metadata, ...Metadata };
//         return res.json({ productId: productid, Metadata: product.Metadata });
//     }
//     res.status(404).json({ error: "Product not found" });
// });

// // API 3: Search with Creative Ranking Algorithm [cite: 81, 82]
// app.get('/api/v1/search/product', (req, res) => {
//     const query = (req.query.query || "").toLowerCase();
    
//     // Filter results based on title/description [cite: 27]
//     let results = products.filter(p => 
//         p.title.toLowerCase().includes(query) || 
//         p.description.toLowerCase().includes(query)
//     );

//     // Apply Ranking Algorithm [cite: 28, 29]
//     results = results.map(p => {
//         let score = (p.rating * 10) + (p.units_sold / 100); // Base Score
        
//         // Handling "Sasta" (Cheap) intent for Tier-2/3 cities [cite: 2, 12]
//         if (query.includes("sasta") || query.includes("cheap")) {
//             score += (150000 - p.Sellingprice) / 1000; // Boost lower prices
//         }
        
//         // Stock availability boost [cite: 9]
//         if (p.stock > 0) score += 20;

//         return { ...p, searchScore: score };
//     });

//     // Sort by score descending [cite: 28]
//     results.sort((a, b) => b.searchScore - a.searchScore);

//     res.json({ data: results.slice(0, 20) }); // Top 20 results [cite: 82]
// });

// const PORT = 3000;
// app.listen(PORT, () => {
//     console.log(`Microservice live at http://localhost:${PORT}`);
//     console.log(`Latency requirement: < 1000ms [cite: 142]`);
// });




const express = require('express');
const fs = require('fs');
const Fuse = require('fuse.js');

const app = express();
app.use(express.json());

// 1. LOAD DATA IN-MEMORY
// We load the catalog once at startup to ensure <1000ms latency
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
    threshold: 0.4, // Balance between strictness and finding "Ifone" for "iPhone"
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
        // Re-index Fuse after adding new data
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

        // A. INTENT EXTRACTION (Tier-2/3 Strategy)
        const isSasta = rawQuery.includes("sasta") || rawQuery.includes("cheap") || rawQuery.includes("sastha");
        const isLatest = rawQuery.includes("latest") || rawQuery.includes("new");
        
        // B. CLEAN QUERY (Remove intent words to improve fuzzy matching accuracy)
        const cleanQuery = rawQuery.replace(/sasta|cheap|sastha|latest|new/g, "").trim();
        
        // C. FUZZY MATCHING
        // If query was "Sasta Ifone", we now fuzzy search for "Ifone"
        let searchResults = fuse.search(cleanQuery || rawQuery);

        // D. HYBRID RANKING ALGORITHM
        let rankedData = searchResults.map(result => {
            const p = result.item;
            
            // 1. Text Relevance Score (from Fuse.js)
            // Fuse score is 0 (perfect) to 1 (no match). We invert it.
            let score = (1 - result.score) * 100;

            // 2. Business Metrics (Rating & Sales)
            score += (p.rating * 15); // High weight for quality
            score += (p.units_sold / 50); // Weight for popularity

            // 3. Hinglish Intent: "Sasta" (Price Sensitivity)
            if (isSasta) {
                // Boost items with lower selling price (relative to a 1.5L max price)
                score += (150000 - p.Sellingprice) / 1000;
            }

            // 4. "Latest" Intent
            if (isLatest) {
                // Assuming higher product IDs or specific metadata brands
                score += (p.productid / 100);
            }

            // 5. Stock Availability (Critical for E-commerce)
            if (p.stock > 0) {
                score += 30; // Strong boost for items you can actually buy
            } else {
                score -= 50; // Penalty for out of stock
            }

            return { ...p, search_score: parseFloat(score.toFixed(2)) };
        });

        // E. FINAL SORTING
        rankedData.sort((a, b) => b.search_score - a.search_score);

        res.json({ data: rankedData.slice(0, 20) });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Search engine error" });
    }
});

// START SERVER
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Search Microservice Running`);
    console.log(`URL: http://localhost:${PORT}/api/v1/search/product?query=Sasta iPhone`);
});