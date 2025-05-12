// server.js
// Backend for Synchronised Focus Session (Phase 1)
// Uses Node.js, Express, and ws (WebSocket library)

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
// Serve static files (like your HTML, CSS, client-side JS)
// In a real deployment, you might serve frontend from a CDN or dedicated web server.
// For this example, we assume the HTML file generated previously is in a 'public' directory
// or you'll adjust path. For simplicity, we won't explicitly serve static files here,
// assuming the HTML is opened directly or served by another means if you split files.
// If you put the HTML in a 'public' folder: app.use(express.static('public'));
// Serve static files from the current directory (where index.html is)
app.use(express.static(path.join(__dirname)));

// Specifically serve index.html for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- IN-MEMORY SESSION STORAGE (EPHEMERAL FOR PHASE 1) ---
// sessions = {
//   "sessionId1": {
//     id: "sessionId1",
//     overallSessionTimerStart: Date.now(),
//     overallSessionTime: 0, // in seconds
//     users: {
//       "userId1": {
//         ws: WebSocketConnection,
//         id: "userId1",
//         goal: "Main goal text",
//         goalDescription: "Detailed description",
//         tasks: [{ id: "t1", text: "Task 1", completed: false, crossedOff: false, description: "" }],
//         workTimerStart: Date.now(),
//         breakTimerStart: null,
//         accumulatedWorkTime: 0, // in seconds
//         accumulatedBreakTime: 0, // in seconds
//         timerState: "work", // "work" or "break"
//         lastHeartbeat: Date.now()
//       }
//     },
//     timerInterval: setIntervalReference
//   }
// }
let sessions = {};
const HEARTBEAT_CHECK_INTERVAL_MS = 15000; // Check every 15s
const USER_TIMEOUT_MS = 75000; // 75s (must be > 2 * client heartbeat interval)
const ORPHANED_SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ORPHANED_SESSION_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours if never joined
const MAX_EMPTY_SESSION_AGE_MS = 10 * 60 * 1000; // 10 minutes if all users left

// --- UTILITY FUNCTIONS ---
function generateUniqueId(prefix = '') {
    return prefix + Math.random().toString(36).substr(2, 9);
}

function broadcast(sessionId, message, excludeWs = null) {
    const session = sessions[sessionId];
    if (session) {
        Object.values(session.users).forEach(user => {
            if (user.ws !== excludeWs && user.ws.readyState === WebSocket.OPEN) {
                try {
                    user.ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error(`Error broadcasting to user ${user.id}:`, error);
                    // Handle potential errors during send, e.g. if socket closed abruptly
                }
            }
        });
    }
}

function getParticipantData(user) {
    return {
        userId: user.id,
        goal: user.goal,
        goalDescription: user.goalDescription,
        tasks: user.tasks,
        workTime: user.accumulatedWorkTime + (user.timerState === 'work' && user.workTimerStart ? Math.floor((Date.now() - user.workTimerStart) / 1000) : 0),
        breakTime: user.accumulatedBreakTime + (user.timerState === 'break' && user.breakTimerStart ? Math.floor((Date.now() - user.breakTimerStart) / 1000) : 0),
        timerState: user.timerState,
    };
}

function getFullSessionState(sessionId) {
    const session = sessions[sessionId];
    if (!session) return null;

    const usersArray = Object.values(session.users).map(getParticipantData);
    return {
        overallSessionTime: session.overallSessionTime,
        users: usersArray,
    };
}

function updateAndBroadcastTimers(sessionId) {
    const session = sessions[sessionId];
    if (!session) return;

    session.overallSessionTime = Math.floor((Date.now() - session.overallSessionTimerStart) / 1000);

    const userTimerUpdates = [];
    Object.values(session.users).forEach(user => {
        let currentWorkDuration = 0;
        let currentBreakDuration = 0;

        if (user.timerState === 'work' && user.workTimerStart) {
            currentWorkDuration = Math.floor((Date.now() - user.workTimerStart) / 1000);
        } else if (user.timerState === 'break' && user.breakTimerStart) {
            currentBreakDuration = Math.floor((Date.now() - user.breakTimerStart) / 1000);
        }
        
        userTimerUpdates.push({
            userId: user.id,
            workTime: user.accumulatedWorkTime + currentWorkDuration,
            breakTime: user.accumulatedBreakTime + currentBreakDuration,
            timerState: user.timerState
        });
    });

    broadcast(sessionId, {
        type: 'TIMER_UPDATE',
        payload: {
            overallSessionTime: session.overallSessionTime,
            users: userTimerUpdates,
        }
    });
}

function stopSessionTimers(sessionId) {
    const session = sessions[sessionId];
    if (session && session.timerInterval) {
        clearInterval(session.timerInterval);
        session.timerInterval = null;
    }
}

function deleteSession(sessionId) {
    console.log(`Deleting session: ${sessionId}`);
    stopSessionTimers(sessionId);
    delete sessions[sessionId];
}

// --- HEARTBEAT & TIMEOUT HANDLING ---
setInterval(() => {
    const now = Date.now();
    Object.keys(sessions).forEach(sessionId => {
        const session = sessions[sessionId];
        let activeUsers = 0;
        Object.values(session.users).forEach(user => {
            if (now - user.lastHeartbeat > USER_TIMEOUT_MS) {
                console.log(`User ${user.id} in session ${sessionId} timed out. Closing connection.`);
                user.ws.terminate(); // This will trigger the 'close' event for cleanup
            } else {
                activeUsers++;
            }
        });
        if (activeUsers === 0 && Object.keys(session.users).length > 0) { // All users timed out or left
             if(!session.markedForDeletionTime) {
                session.markedForDeletionTime = now;
             }
             if (now - session.markedForDeletionTime > MAX_EMPTY_SESSION_AGE_MS) {
                console.log(`Session ${sessionId} is empty for too long. Deleting.`);
                deleteSession(sessionId);
             }
        } else if (activeUsers > 0) {
            delete session.markedForDeletionTime; // Reset deletion mark if users are active
        }
    });
}, HEARTBEAT_CHECK_INTERVAL_MS);

// Orphaned session cleanup (sessions created but never joined, or empty for too long)
setInterval(() => {
    const now = Date.now();
    Object.keys(sessions).forEach(sessionId => {
        const session = sessions[sessionId];
        const userCount = Object.keys(session.users).length;
        if (userCount === 0) {
            // If session was created long ago and never had users, or has been empty for a while
            const age = now - session.overallSessionTimerStart; // Using this as creation time
            if (!session.firstUserJoinedTime && age > MAX_ORPHANED_SESSION_AGE_MS) {
                 console.log(`Orphaned session ${sessionId} (never joined) is too old. Deleting.`);
                 deleteSession(sessionId);
            } else if (session.firstUserJoinedTime && session.markedForDeletionTime && (now - session.markedForDeletionTime > MAX_EMPTY_SESSION_AGE_MS)) {
                 console.log(`Empty session ${sessionId} is too old. Deleting.`);
                 deleteSession(sessionId);
            }
        }
    });
}, ORPHANED_SESSION_CLEANUP_INTERVAL_MS);


// --- WEB SOCKET SERVER LOGIC ---
wss.on('connection', (ws, req) => {
    const parameters = url.parse(req.url, true).query;
    const sessionId = parameters.sessionId;
    const userId = parameters.userId;

    if (!sessionId || !userId) {
        console.log('Connection attempt without sessionId or userId. Closing.');
        ws.close();
        return;
    }

    console.log(`User ${userId} attempting to connect to session ${sessionId}`);

    // Create session if it doesn't exist
    if (!sessions[sessionId]) {
        sessions[sessionId] = {
            id: sessionId,
            overallSessionTimerStart: Date.now(),
            overallSessionTime: 0,
            users: {},
            timerInterval: setInterval(() => updateAndBroadcastTimers(sessionId), 1000), // Update every second
            firstUserJoinedTime: null, // Track if anyone ever joined
            markedForDeletionTime: null // For empty session cleanup
        };
        console.log(`Created new session: ${sessionId}`);
    }

    const session = sessions[sessionId];
    if (!session.firstUserJoinedTime) {
        session.firstUserJoinedTime = Date.now();
    }
    delete session.markedForDeletionTime; // A user joined, so it's not marked for deletion

    // Check if user already exists (e.g., reconnection)
    if (session.users[userId]) {
        console.log(`User ${userId} reconnected to session ${sessionId}`);
        session.users[userId].ws.terminate(); // Terminate old connection if any
    } else {
        console.log(`User ${userId} joined session ${sessionId}`);
    }
    
    session.users[userId] = {
        ws: ws,
        id: userId,
        goal: '',
        goalDescription: '',
        tasks: [],
        workTimerStart: Date.now(), // Start work timer immediately on join
        breakTimerStart: null,
        accumulatedWorkTime: 0,
        accumulatedBreakTime: 0,
        timerState: "work",
        lastHeartbeat: Date.now()
    };

    const newUser = session.users[userId];

    // Send current session state to the newly connected user
    const currentSessionState = getFullSessionState(sessionId);
    if (currentSessionState) {
        ws.send(JSON.stringify({ type: 'SESSION_STATE', payload: currentSessionState }));
    }

    // Notify other users about the new participant
    broadcast(sessionId, {
        type: 'USER_JOINED',
        payload: { userData: getParticipantData(newUser) }
    }, ws);


    ws.on('message', (messageData) => {
        newUser.lastHeartbeat = Date.now(); // Update heartbeat on any message
        let message;
        try {
            message = JSON.parse(messageData);
        } catch (e) {
            console.error('Failed to parse message:', messageData, e);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Invalid message format.' } }));
            return;
        }

        console.log(`Received from ${userId} in ${sessionId}:`, message.type, message.payload);

        switch (message.type) {
            case 'heartbeat':
                // Already handled by updating lastHeartbeat
                break;
            case 'SET_GOAL':
                if (!newUser.goal) { // Goal can only be set once
                    newUser.goal = message.payload.goal;
                    newUser.goalDescription = message.payload.description || '';
                    broadcast(sessionId, {
                        type: 'GOAL_UPDATED',
                        payload: { userId, goal: newUser.goal, description: newUser.goalDescription }
                    });
                } else {
                     ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Main goal already set for this session.' } }));
                }
                break;
            case 'SET_GOAL_DESCRIPTION':
                 newUser.goalDescription = message.payload.description || '';
                 broadcast(sessionId, {
                     type: 'GOAL_UPDATED', // Use same event, client can update description part
                     payload: { userId, goal: newUser.goal, description: newUser.goalDescription }
                 });
                break;
            case 'ADD_TASK':
                const newTask = { ...message.payload.task, id: generateUniqueId('task_') }; // Ensure server-generated ID
                newUser.tasks.push(newTask);
                broadcast(sessionId, {
                    type: 'TASK_ADDED', // Or just TASK_UPDATED if client handles adding new ones
                    payload: { userId, tasks: newUser.tasks }
                });
                break;
            case 'TOGGLE_TASK_COMPLETION':
                const taskToToggle = newUser.tasks.find(t => t.id === message.payload.taskId);
                if (taskToToggle && !taskToToggle.crossedOff) {
                    taskToToggle.completed = !taskToToggle.completed;
                    broadcast(sessionId, {
                        type: 'TASK_UPDATED',
                        payload: { userId, tasks: newUser.tasks }
                    });
                }
                break;
            case 'CROSS_OFF_TASK':
                const taskToCross = newUser.tasks.find(t => t.id === message.payload.taskId);
                if (taskToCross) {
                    taskToCross.crossedOff = true;
                    taskToCross.completed = false; // Crossing off implies not completed
                    broadcast(sessionId, {
                        type: 'TASK_UPDATED',
                        payload: { userId, tasks: newUser.tasks }
                    });
                }
                break;
            case 'UPDATE_TASK_DESCRIPTION':
                const taskToDescribe = newUser.tasks.find(t => t.id === message.payload.taskId);
                if (taskToDescribe) {
                    taskToDescribe.description = message.payload.description;
                     broadcast(sessionId, {
                        type: 'TASK_UPDATED',
                        payload: { userId, tasks: newUser.tasks }
                    });
                }
                break;
            case 'START_BREAK':
                if (newUser.timerState === 'work') {
                    newUser.accumulatedWorkTime += Math.floor((Date.now() - newUser.workTimerStart) / 1000);
                    newUser.workTimerStart = null;
                    newUser.breakTimerStart = Date.now();
                    newUser.timerState = 'break';
                    updateAndBroadcastTimers(sessionId); // Immediate broadcast of state change
                }
                break;
            case 'RESUME_WORK':
                if (newUser.timerState === 'break') {
                    newUser.accumulatedBreakTime += Math.floor((Date.now() - newUser.breakTimerStart) / 1000);
                    newUser.breakTimerStart = null;
                    newUser.workTimerStart = Date.now();
                    newUser.timerState = 'work';
                    updateAndBroadcastTimers(sessionId); // Immediate broadcast of state change
                }
                break;
            case 'STOP_SESSION': // User explicitly leaves
                // Calculate final times before sending summary
                if (newUser.timerState === 'work' && newUser.workTimerStart) {
                    newUser.accumulatedWorkTime += Math.floor((Date.now() - newUser.workTimerStart) / 1000);
                } else if (newUser.timerState === 'break' && newUser.breakTimerStart) {
                    newUser.accumulatedBreakTime += Math.floor((Date.now() - newUser.breakTimerStart) / 1000);
                }
                ws.send(JSON.stringify({
                    type: 'INDIVIDUAL_SUMMARY',
                    payload: {
                        mainGoal: newUser.goal,
                        mainGoalDescription: newUser.goalDescription,
                        tasks: newUser.tasks,
                        totalWorkTime: newUser.accumulatedWorkTime,
                        totalBreakTime: newUser.accumulatedBreakTime,
                    }
                }));
                ws.close(); // This will trigger 'close' event for full cleanup
                break;

            default:
                console.log(`Unknown message type from ${userId}: ${message.type}`);
                ws.send(JSON.stringify({ type: 'ERROR', payload: { message: `Unknown message type: ${message.type}` } }));
        }
    });

    ws.on('close', () => {
        console.log(`User ${userId} disconnected from session ${sessionId}`);
        // Calculate final times before removing user
        if (newUser.timerState === 'work' && newUser.workTimerStart) {
            newUser.accumulatedWorkTime += Math.floor((Date.now() - newUser.workTimerStart) / 1000);
        } else if (newUser.timerState === 'break' && newUser.breakTimerStart) {
            newUser.accumulatedBreakTime += Math.floor((Date.now() - newUser.breakTimerStart) / 1000);
        }
        
        delete session.users[userId];

        if (Object.keys(session.users).length === 0) {
            console.log(`Session ${sessionId} is now empty. Marking for potential deletion.`);
            session.markedForDeletionTime = Date.now();
            // Actual deletion will be handled by the cleanup interval if it remains empty.
            // For immediate deletion on last user exit: deleteSession(sessionId);
        } else {
            broadcast(sessionId, { type: 'USER_LEFT', payload: { userId } });
        }
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for user ${userId} in session ${sessionId}:`, error);
        // The 'close' event will usually follow, handling cleanup.
    });
});


// Basic HTTP endpoint (optional, can be used for health check or info)
app.get('/', (req, res) => {
    res.send('Synchronised Focus Session Backend is running. Connect via WebSocket.');
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
    console.log(`WebSocket server started on ws://localhost:${PORT}`);
});
