export const getMainTsx = (title, webviewPath = 'index.html') => {
  const safeTitle = title.replace(/'/g, "\\'");
  return `/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

import { Devvit, useAsync, useState } from '@devvit/public-api';

// Registry key for tracking database collections
const DB_REGISTRY_KEY = 'sys:registry';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// Server-side data fetching function
async function fetchAllData(redis, reddit) {
    try {
        // 1. Get all registered collections
        const collections = await redis.zRange(DB_REGISTRY_KEY, 0, -1);
        const dbData = {};

        // 2. Fetch all collection data in parallel
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

        // 3. Get current user info
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
        return null;
    }
}

// Menu action to create game posts
Devvit.addMenuItem({
  label: 'Add Game Post',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: '${safeTitle}',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading Game...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Created Game Post!' });
    ui.navigateTo(post);
  },
});

// Main custom post component
Devvit.addCustomPostType({
  name: 'WebSim Game',
  height: 'tall',
  render: (context) => {
    const { redis, reddit, ui } = context;
    
    // Pre-fetch data on server side using useAsync
    const { data: initialData, loading } = useAsync(async () => {
        return await fetchAllData(redis, reddit);
    });

    const [webviewVisible, setWebviewVisible] = useState(false);

    // Show webview once data is loaded
    if (!loading && initialData && !webviewVisible) {
        setWebviewVisible(true);
    }

    return (
      <vstack height="100%" width="100%">
        <webview
          id="gameview"
          url="${webviewPath}"
          width="100%"
          height="100%"
          onMessage={async (msg) => {
            // ✅ CRITICAL FIX: onMessage only receives ONE parameter (the message)
            // Access redis, ui, reddit from the outer context closure
            
            // Extract message data
            const { type, payload } = msg || {};

            if (!type) return;

            // A. Client Ready - Send Hydration Data
            if (type === 'CLIENT_READY' || type === 'DB_LOAD') {
                if (initialData) {
                    ui.webView.postMessage('gameview', {
                        type: 'DB_HYDRATE',
                        payload: initialData.dbData,
                        user: initialData.user
                    });
                }
            }

            // B. Database Save
            if (type === 'DB_SAVE' && payload) {
                try {
                    const { collection, key, value } = payload;
                    
                    // Save to Redis
                    await redis.hSet(collection, { 
                        [key]: JSON.stringify(value) 
                    });
                    
                    // Update registry
                    await redis.zAdd(DB_REGISTRY_KEY, { 
                        member: collection, 
                        score: Date.now() 
                    });
                    
                    // Acknowledge save
                    ui.webView.postMessage('gameview', {
                        type: 'DB_SAVE_SUCCESS',
                        payload: { collection, key }
                    });
                } catch(e) {
                    console.error('DB Save Error:', e);
                    ui.webView.postMessage('gameview', {
                        type: 'DB_SAVE_ERROR',
                        payload: { error: e.message }
                    });
                }
            }
            
            // C. Database Query
            if (type === 'DB_GET' && payload) {
                try {
                    const { collection, key } = payload;
                    const value = await redis.hGet(collection, key);
                    
                    ui.webView.postMessage('gameview', {
                        type: 'DB_GET_RESPONSE',
                        payload: { 
                            collection, 
                            key, 
                            value: value ? JSON.parse(value) : null 
                        }
                    });
                } catch(e) {
                    console.error('DB Get Error:', e);
                }
            }
            
            // D. Database Delete
            if (type === 'DB_DELETE' && payload) {
                try {
                    const { collection, key } = payload;
                    await redis.hDel(collection, [key]);
                    
                    ui.webView.postMessage('gameview', {
                        type: 'DB_DELETE_SUCCESS',
                        payload: { collection, key }
                    });
                } catch(e) {
                    console.error('DB Delete Error:', e);
                }
            }
            
            // E. Logging
            if (type === 'console') {
                console.log('[Web]', ...(msg.args || []));
            }
          }}
        />
      </vstack>
    );
  },
});

export default Devvit;
`;
};

