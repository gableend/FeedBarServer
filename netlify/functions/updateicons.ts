import { Handler } from '@netlify/functions';
import { supabase } from '../../src/supabase';
import { getBestIcon } from '../../src/icons';

export const handler: Handler = async (event) => {
    // 1. Get feeds that are missing icons
    const { data: feeds } = await supabase
        .from('feeds')
        .select('id, url')
        .is('icon_url', null);

    if (!feeds || feeds.length === 0) {
        return { statusCode: 200, body: 'All icons are already set.' };
    }

    console.log(`Updating icons for ${feeds.length} feeds...`);

    for (const feed of feeds) {
        const icon = await getBestIcon(feed.url);
        if (icon) {
            await supabase
                .from('feeds')
                .update({ icon_url: icon })
                .eq('id', feed.id);
            console.log(`✅ Set icon for ${feed.url}`);
        }
    }

    return { statusCode: 200, body: `Updated ${feeds.length} icons.` };
};