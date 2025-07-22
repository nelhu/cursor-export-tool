const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DEBUG = false;

// Export chat history for all workspaces
async function exportAllChatHistory () {

  try {
    let workspaces = await getAllWorkspaces();

    let filterdWorkspaces = DEBUG ? workspaces
      .filter((w) => {
        if (w && w.folder) {
          return w.folder.endsWith('cursor-export')
        }
        return false;
      })
      : workspaces;

    const allChats = [];

    for (const workspace of filterdWorkspaces) {

      try {
        const detail = await getWorkspaceDetail(workspace.id, workspace.folder);

        if (DEBUG) {
          if (detail) {
            await fs.writeFile('debug/detail.json', JSON.stringify(detail, null, 2));
          }
        }

        allChats.push({
          workspaceInfo: workspace,
          chatData: detail
        });
      } catch (error) {
        console.error(`Error getting details for workspace ${workspace.id}:`, error);
      }
    }

    if (DEBUG) {
      await fs.writeFile('debug/allChats.json', JSON.stringify(allChats, null, 2));
    }

    return allChats;
  } catch (error) {
    console.error('Failed to export chat history:', error);
    throw error;
  }
}

// Helper function to safely parse timestamps
const safeParseTimestamp = (timestamp) => {
  try {
    if (!timestamp) {
      return new Date().toISOString();
    }
    return new Date(timestamp).toISOString();
  } catch (error) {
    console.error('Error parsing timestamp:', error, 'Raw value:', timestamp);
    return new Date().toISOString();
  }
};

// Get all workspaces with chat data
async function getAllWorkspaces () {
  try {
    const workspacePath = process.env.WORKSPACE_PATH || '/Users/xuezi/Library/Application Support/Cursor/User/workspaceStorage';
    const workspaces = [];

    const entries = await fs.readdir(workspacePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dbPath = path.join(workspacePath, entry.name, 'state.vscdb');
        const workspaceJsonPath = path.join(workspacePath, entry.name, 'workspace.json');

        if (!existsSync(dbPath)) {
          console.log(`Skipping ${entry.name}: no state.vscdb found`);
          continue;
        }

        try {
          const stats = await fs.stat(dbPath);
          const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
          });

          const result = await db.get(`
            SELECT value FROM ItemTable 
            WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
          `);

          let chatCount = 0;
          if (result?.value) {
            try {
              const chatData = JSON.parse(result.value);
              chatCount = chatData.tabs?.length || 0;
            } catch (error) {
              console.error('Error parsing chat data:', error);
            }
          }

          let folder = undefined;
          try {
            const workspaceData = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf-8'));
            folder = workspaceData.folder;
          } catch (error) {
            console.log(`No workspace.json found for ${entry.name}`);
          }

          workspaces.push({
            id: entry.name,
            path: dbPath,
            folder: folder,
            lastModified: stats.mtime.toISOString(),
            chatCount: chatCount
          });

          await db.close();
        } catch (error) {
          console.error(`Error processing workspace ${entry.name}:`, error);
        }
      }
    }

    return workspaces;
  } catch (error) {
    console.error('Failed to get workspaces:', error);
    throw error;
  }
}

// Get detailed chat data for a specific workspace
async function getWorkspaceDetail (workspaceId, workspaceFolder) {

  try {
    const workspacePath = process.env.WORKSPACE_PATH || '/Users/xuezi/Library/Application Support/Cursor/User/workspaceStorage';
    const dbPath = path.join(workspacePath, workspaceId, 'state.vscdb');

    if (DEBUG) {
      console.log('workspaceId', workspaceId);
      console.log('dbPath', dbPath);
    }

    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });

    const chatResult = await db.get(`
      SELECT value FROM ItemTable
      WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'
    `);

    if (DEBUG) {
      console.log('chatResult', chatResult);
    }

    const composerResult = await db.get(`
      SELECT value FROM ItemTable
      WHERE [key] = 'composer.composerData'
    `);

    await db.close();

    if (!chatResult && !composerResult) {
      return {
        tabs: [],
        composers: {
          allComposers: []
        }
      }
    }

    const response = { tabs: [] };

    if (chatResult) {
      const chatData = JSON.parse(chatResult.value);
      response.tabs = chatData.tabs.map((tab) => ({
        id: tab.tabId,
        title: tab.chatTitle?.split('\n')[0] || `Chat ${tab.tabId.slice(0, 8)}`,
        timestamp: safeParseTimestamp(tab.lastSendTime),
        bubbles: tab.bubbles
      }));
    }

    if (DEBUG) {
      if (chatResult) {
        await fs.writeFile('debug/chatResult.json', chatResult.value, null, 2);
      }

      if (composerResult) {
        await fs.writeFile('debug/composerResult.json', composerResult.value, null, 2);
      }
    }

    if (composerResult) {
      const globalDbPath = path.join(workspacePath, '..', 'globalStorage', 'state.vscdb');
      const composers = JSON.parse(composerResult.value);
      const keys = composers.allComposers.map((it) => `composerData:${it.composerId}`);
      const placeholders = keys.map(() => '?').join(',');

      const globalDb = await open({
        filename: globalDbPath,
        driver: sqlite3.Database
      });

      const composersBodyResult = await globalDb.all(`
        SELECT [key], value FROM cursorDiskKV
        WHERE [key] in (${placeholders})
      `, keys);

      await globalDb.close();

      if (composersBodyResult && composersBodyResult.length > 0) {
        const composerDetails = composersBodyResult.map(result => {
          const composerId = result.key.replace('composerData:', '');
          const composerData = JSON.parse(result.value);
          return {
            ...composerData,
            composerId
          };
        });

        if (DEBUG) {
          await fs.writeFile('debug/allComposers.json', JSON.stringify(composerDetails, null, 2));
        }

        response.composers = {
          allComposers: composerDetails
        };
      }
    }

    if (DEBUG) {
      await fs.writeFile('debug/response.json', JSON.stringify(response, null, 2));
    }

    return response;
  } catch (error) {
    console.error('Failed to get workspace data:', error);
    throw error;
  }
}

module.exports = {
  getAllWorkspaces,
  getWorkspaceDetail,
  exportAllChatHistory
};
