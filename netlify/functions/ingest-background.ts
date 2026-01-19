import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';

// Initialize Parser
const parser = new Parser({
    timeout: 5000, 
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
    }
});

const supabase = createClient(
    process.env.SUPABASE_URL || '', 
    process.env.SUPABASE_KEY || ''
);

const isFatalError = (err: any) => {
    const msg = (err.message || String(err)).toLowerCase();
    return msg.includes('status code 404') || 
           msg.includes('status code 403') || 
           msg.includes('status code 410') ||
           msg.includes('non-whitespace before first tag') ||
           msg.includes('unexpected close tag') ||
           msg.includes('invalid character');
};

export const handler = schedule('*/10 * * * *', async (event) => {
    console.log("⚡️ Aggressive Ingest started...");
    
    // 1. Get 10 feeds
    const { data: feeds } = await supabase
        .from('feeds')
        .select('id, url, name') 
        .eq('is_active', true)
        .order('last_fetched_at', { ascending: true, nullsFirst: true }) 
        .limit(10); 
        
    if (!feeds?.length) return { statusCode: 200 };

    console.log(`Processing Batch of ${feeds.length} feeds...`);

    // 2. Process Feeds
    await Promise.all(feeds.map(async (feed) => {
        try {
            // Attempt Fetch
            const feedData = await parser.parseURL(feed.url);
            const items = feedData.items || [];
            
            // --- SUCCESS PATH ---
            if (items.length > 0) {
                const rows = items.map((i: any) => ({
                    feed_id: feed.id,
                    title: i.title || 'Untitled',
                    url: i.link || i.enclosure?.url || i.guid, 
                    published_at: i.isoDate ? new Date(i.isoDate).toISOString() : 
                                  (i.pubDate ? new Date(i.pubDate).toISOString() : new Date().toISOString()),
                    summary: (i.contentSnippet || i.content || i.summary || '').substring(0, 300),
                    image_url: i.enclosure?.url || i.itunes?.image || null
                }));

                const validRows = rows.filter((r: any) => r.url && r.title);

                if (validRows.length > 0) {
                    await supabase
                        .from('items')
                        .upsert(validRows, { onConflict: 'url', ignoreDuplicates: true });
                }

                // Mark as Healthy
                await supabase.from('feeds')
                    .update({ last_fetched_at: new Date().toISOString() })
                    .eq('id', feed.id);
            } 
            // --- EMPTY PATH (New Aggressive Triage) ---
            else {
                console.warn(`💀 EMPTY: Disabling ${feed.name} (0 items returned).`);
                
                // 1. Log to Triage
                await supabase.from('feed_errors').insert({
                    feed_id: feed.id,
                    feed_name: feed.name,
                    feed_url: feed.url,
                    error_code: 'NO_ITEMS',
                    error_message: 'Feed returned 0 items (Soft Fail or Empty)'
                });

                // 2. Kill the Feed
                await supabase.from('feeds')
                    .update({ 
                        is_active: false, 
                        last_fetched_at: new Date().toISOString() 
                    })
                    .eq('id', feed.id);
            }

        } catch (err: any) {
            // --- FAILURE PATH ---
            const errorMsg = err.message || String(err);
            
            if (isFatalError(err)) {
                console.error(`💀 FATAL: Disabling ${feed.name} due to hard error.`);
                
                await supabase.from('feed_errors').insert({
                    feed_id: feed.id,
                    feed_name: feed.name,
                    feed_url: feed.url,
                    error_code: errorMsg.includes('404') ? '404' : (errorMsg.includes('403') ? '403' : 'XML_ERROR'),
                    error_message: errorMsg
                });

                await supabase.from('feeds')
                    .update({ 
                        is_active: false, 
                        last_fetched_at: new Date().toISOString()
                    })
                    .eq('id', feed.id);
            } else {
                // Temporary Error (500, Timeout) - Just touch timestamp
                 await supabase.from('feeds')
                    .update({ last_fetched_at: new Date().toISOString() })
                    .eq('id', feed.id);
            }
        }
    }));

    // 3. Cleanup
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    await supabase.from('items').delete().lt('published_at', sevenDaysAgo.toISOString());

    console.log("✅ Batch complete.");
    return { statusCode: 200 };
});