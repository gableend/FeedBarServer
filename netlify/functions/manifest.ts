import { createClient } from '@supabase/supabase-js'

export const handler = async (event: any, context: any) => {
    // 1. Initialize Supabase (Node.js style)
    const supabaseUrl = process.env.SUPABASE_URL || ''
    const supabaseKey = process.env.SUPABASE_KEY || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    try {
        // 2. Fetch Items (Articles) + Linked Feed Info
        // Note: We access 'category' directly on 'feeds', matching your new DB schema
        const { data: items, error } = await supabase
            .from('items')
            .select(`
                id, 
                title, 
                url, 
                published_at, 
                image_url, 
                feeds (
                    id,
                    name, 
                    url,
                    category
                )
            `)
            .order('published_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        const response = {
            generated_at: new Date().toISOString(),
            items: (items || []).map((i: any) => {
                // Handle array vs object for relations
                const feedInfo = Array.isArray(i.feeds) ? i.feeds[0] : i.feeds;
                
                // HOSTNAME EXTRACTION
                let domain = 'news.source';
                if (feedInfo?.url) {
                    try { domain = new URL(feedInfo.url).hostname.replace('www.', ''); } 
                    catch (e) { domain = 'source.com'; }
                }

                // CATEGORY PRIORITY:
                // We use the direct column 'category' from the feeds table
                const dbCategory = feedInfo?.category || null;

                return {
                    id: i.id,
                    title: i.title || 'Untitled',
                    url: i.url || '#',
                    feed_id: feedInfo?.id || '00000000-0000-0000-0000-000000000000', 
                    source_name: feedInfo?.name || 'General News',
                    source_domain: domain,
                    category: dbCategory, // <--- Sends the real DB category to the Ticker
                    published_at: i.published_at,
                    image_url: i.image_url || null
                };
            })
        };

        return {
            statusCode: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*' // CORS support
            },
            body: JSON.stringify(response)
        };

    } catch (err: any) {
        return { 
            statusCode: 500, 
            body: JSON.stringify({ error: err.message || String(err) }) 
        };
    }
};