import { schedule } from '@netlify/functions';
import { supabase } from '../../src/supabase';
import { fetchFeed } from '../../src/rss';

const handler = schedule('*/10 * * * *', async (event) => {
    console.log("⚡️ Ingest started...");
    
    // 1. Get Active Feeds
    const { data: feeds } = await supabase
        .from('feeds')
        .select('id, url')
        .eq('is_active', true);
        
    if (!feeds?.length) return { statusCode: 200 };

    // 2. Fetch & Update DB
    await Promise.allSettled(feeds.map(async (feed) => {
        const items = await fetchFeed(feed.url);
        if (!items?.length) return;

        const rows = items.map(i => {
            // --- DEEP IMAGE EXTRACTION ---
            // If the parser missed the image, we try to find it in the summary/content
            let finalImageUrl = i.image_url;
            
            if (!finalImageUrl && i.summary) {
                // Look for the first <img> tag in the HTML content
                const imgMatch = i.summary.match(/<img[^>]+src="([^">]+)"/);
                if (imgMatch && imgMatch[1]) {
                    finalImageUrl = imgMatch[1];
                }
            }

            return {
                feed_id: feed.id,
                title: i.title,
                url: i.url,
                published_at: i.published_at.toISOString(),
                author: i.author,
                summary: i.summary?.replace(/<[^>]*>?/gm, '').substring(0, 200), // Clean HTML from summary
                image_url: finalImageUrl
            };
        });

        // Upsert (Insert if new, ignore if exists based on URL)
        await supabase.from('items').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
        
        // Update timestamp
        await supabase.from('feeds').update({ last_fetched_at: new Date() }).eq('id', feed.id);
    }));

    // 3. AUTO-CLEANUP (Keep the DB lean)
    // Deletes items older than 3 days so the 'manifest' function stays lightning fast
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    await supabase
        .from('items')
        .delete()
        .lt('published_at', threeDaysAgo.toISOString());

    console.log("✅ Ingest and Cleanup complete.");
    return { statusCode: 200 };
});

export { handler };