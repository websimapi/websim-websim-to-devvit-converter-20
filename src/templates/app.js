export const getServerDbJs = () => `
import { redis, reddit } from '@devvit/web/server';

export const DB_REGISTRY_KEY = 'sys:registry';

export async function fetchAllData() {
    try {
        const collections = await redis.zRange(DB_REGISTRY_KEY, 0, -1);
        const dbData = {};

        await Promise.all(collections.map(async (item) => {
            const colName = typeof item === 'string' ? item : item.member;
            const raw = await redis.hGetAll(colName);
            const parsed = {};
            for (const [k, v] of Object.entries(raw)) {
                try { 
                    parsed[k] = JSON.parse(v); 
                } catch(e) { 
                    parsed[k] = v; 
                }
            }
            dbData[colName] = parsed;
        }));

        let user = { 
            id: 'anon', 
            username: 'Guest', 
            avatar_url: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png' 
        };
        
        try {
            const currUser = await reddit.getCurrentUser();
            if (currUser) {
                user = {
                    id: currUser.id,
                    username: currUser.username,
                    avatar_url: currUser.snoovatarImage || user.avatar_url
                };
            }
        } catch(e) { 
            console.warn('User fetch failed', e); 
        }

        return { dbData, user };
    } catch(e) {
        console.error('Hydration Error:', e);
        return { dbData: {}, user: null };
    }
}
`;

export const getServerInitJs = () => `
import { fetchAllData } from './db.js';

export default async function (req, res) {
    const data = await fetchAllData();
    res.json(data);
}
`;

export const getServerSaveJs = () => `
import { redis } from '@devvit/web/server';
import { DB_REGISTRY_KEY } from './db.js';

export default async function (req, res) {
    try {
        const { collection, key, value } = await req.json();
        await redis.hSet(collection, { [key]: JSON.stringify(value) });
        await redis.zAdd(DB_REGISTRY_KEY, { member: collection, score: Date.now() });
        res.json({ success: true, collection, key });
    } catch(e) {
        console.error('DB Save Error:', e);
        res.status(500).json({ error: e.message });
    }
}
`;

export const getServerLoadJs = () => `
import { redis } from '@devvit/web/server';

export default async function (req, res) {
    try {
        const { collection, key } = await req.json();
        const value = await redis.hGet(collection, key);
        res.json({ collection, key, value: value ? JSON.parse(value) : null });
    } catch(e) {
        console.error('DB Get Error:', e);
        res.status(500).json({ error: e.message });
    }
}
`;

export const getServerDeleteJs = () => `
import { redis } from '@devvit/web/server';

export default async function (req, res) {
    try {
        const { collection, key } = await req.json();
        await redis.hDel(collection, [key]);
        res.json({ success: true, collection, key });
    } catch(e) {
        console.error('DB Delete Error:', e);
        res.status(500).json({ error: e.message });
    }
}
`;

export const getServerOnInstallJs = () => `
// Maps to /internal/onInstall
export default async function (req, res) {
    console.log('App installed!');
    res.json({ success: true });
}
`;

export const getServerCreatePostJs = (title) => {
    const safeTitle = title.replace(/'/g, "\\'");
    return `
import { reddit } from '@devvit/web/server';

// Maps to /internal/createPost
export default async function (req, res) {
    console.log('Creating game post...');
    try {
        // Access context from the request object
        const { subredditName } = req.context;
        
        if (!subredditName) {
            throw new Error('Could not determine subreddit from context');
        }

        const post = await reddit.submitCustomPost({
            title: '${safeTitle}',
            subredditName: subredditName,
            entry: 'default', // matches devvit.json entrypoint
            userGeneratedContent: {
                text: 'Play this game built with WebSim!'
            }
        });
        
        res.json({
            showToast: { text: 'Game post created!' },
            navigateTo: post
        });
    } catch (e) {
        console.error('Failed to create post:', e);
        res.status(500).json({ error: e.message });
    }
}
`;
};

