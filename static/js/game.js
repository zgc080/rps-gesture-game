/*
 * Rock Paper Scissors AR Game Logic
 * Uses MediaPipe Hands for gesture recognition.
 */

// --- DOM Elements ---
const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');

const playerScoreEl = document.getElementById('player-score');
const aiScoreEl = document.getElementById('ai-score');
const currentRoundEl = document.getElementById('current-round');
const battleLogEl = document.getElementById('battle-log');
const startBtn = document.getElementById('start-btn');
const playHandBtn = document.getElementById('play-hand-btn');
const aiDifficultySelect = document.getElementById('ai-difficulty');
const winningScoreInput = document.getElementById('winning-score-input');
const maxWinsDisplay = document.getElementById('max-wins-display');

const countdownOverlay = document.getElementById('countdown-overlay');
const resultOverlay = document.getElementById('result-overlay');
const resultText = document.getElementById('result-text');
const pMoveIcon = document.getElementById('p-move');
const aiMoveIcon = document.getElementById('ai-move');

const gameOverModal = document.getElementById('game-over-modal');
const finalResultTitle = document.getElementById('final-result-title');
const finalScoreText = document.getElementById('final-score-text');
const restartBtn = document.getElementById('restart-btn');

// --- Game State ---
const STATE = {
    IDLE: 'IDLE',
    COUNTDOWN: 'COUNTDOWN',
    DETECTING: 'DETECTING', // Waiting for user to show a hand
    RESULT: 'RESULT',
    GAME_OVER: 'GAME_OVER'
};

let currentState = STATE.IDLE;
let playerScore = 0;
let aiScore = 0;
let roundCount = 1;
let targetWins = 3;
let lastPlayerMove = null;

// History for Smart AI
// Transitions: What did player throw AFTER throwing X?
// Format: { 'Rock': { 'Rock': 0, 'Paper': 0, 'Scissors': 0 }, ... }
const markovChain = {
    'Rock': { 'Rock': 0, 'Paper': 0, 'Scissors': 0 },
    'Paper': { 'Rock': 0, 'Paper': 0, 'Scissors': 0 },
    'Scissors': { 'Rock': 0, 'Paper': 0, 'Scissors': 0 }
};
const moveHistory = []; // list of past moves

// --- Chart.js Setup ---
const ctx = document.getElementById('statsChart').getContext('2d');
const statsChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
        labels: ['Win', 'Loss', 'Draw'],
        datasets: [{
            data: [0, 0, 0],
            backgroundColor: ['#22c55e', '#ef4444', '#f59e0b'],
            borderWidth: 0
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'right', labels: { color: '#94a3b8' } }
        }
    }
});

let stats = { win: 0, loss: 0, draw: 0 };

// --- Audio System ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playWinSound() {
    playTone(523.25, 'sine', 0.1); // C5
    setTimeout(() => playTone(659.25, 'sine', 0.1), 100); // E5
    setTimeout(() => playTone(783.99, 'sine', 0.4), 200); // G5
}

function playLoseSound() {
    playTone(392.00, 'sawtooth', 0.1); // G4
    setTimeout(() => playTone(311.13, 'sawtooth', 0.4), 150); // Eb4
}

function playDrawSound() {
    playTone(440, 'triangle', 0.3);
}

function playCountdownSound() {
    playTone(880, 'square', 0.05);
}

// --- Gesture Detection ---
// 0: Rock, 1: Paper, 2: Scissors, -1: Unknown
let currentGesture = -1;
let gestureBuffer = []; // For stability check
const BUFFER_SIZE = 5; // Require 5 consecutive frames used in DETECTING mode? Or just strict instant logic?
// Let's use a "Stability Counter" logic
let stableGesture = -1;
let stableCount = 0;

function detectGesture(landmarks) {
    // MediaPipe Hands Landmarks:
    // 0: Wrist
    // 4: Thumb Tip
    // 8: Index Tip
    // 12: Middle Tip
    // 16: Ring Tip
    // 20: Pinky Tip
    
    // Check extended fingers
    // Tip y < DIP y (for index, middle, ring, pinky) - Note: y increases downwards
    // Thumb is trickier, check x relative to MCP?
    
    const isFingerExtended = (tipId, pipId) => {
        // Simple check: is Tip above PIP? (y coordinate is smaller)
        // Adjust for hand rotation if needed, but basic vertical hand works well.
        return landmarks[tipId].y < landmarks[pipId].y;
    };

    // Thumb: Use X distance. If Tip is "outside" IP joint.
    // Determining left/right hand is needed for "outside", or just check relative to Index MCP X.
    // Simplified: Check distance between Tip and Pinky MCP (17). If far, extended.
    // Actually, for Rock/Paper/Scissors, thumb is usually tucked in Rock, out in Paper.
    // Let's use a standard heuristic:
    
    const thumbTip = landmarks[4];
    const thumbIp = landmarks[3];
    const thumbMcp = landmarks[2];
    
    // Check if thumb is extended away from palm.
    // Vector 2->4.
    // Compare with palm direction?
    // Let's try a simpler geometric approach:
    // Pseudo-extension: Distance(4, 17) > Distance(3, 17) ?
    const d = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const thumbExtended = d(thumbTip, landmarks[17]) > d(thumbIp, landmarks[17]) * 1.2;

    const indexExtended = isFingerExtended(8, 6);
    const middleExtended = isFingerExtended(12, 10);
    const ringExtended = isFingerExtended(16, 14);
    const pinkyExtended = isFingerExtended(20, 18);
    
    let extendedCount = 0;
    if (thumbExtended) extendedCount++; // Thumb is unreliable in simple checks
    if (indexExtended) extendedCount++;
    if (middleExtended) extendedCount++;
    if (ringExtended) extendedCount++;
    if (pinkyExtended) extendedCount++;
    
    // Strict Definitions
    // Rock: 0 or 1 (thumb sometimes looks extended) fingers. All non-thumb fingers curled.
    if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) return 0; // Rock

    // Paper: All 4 non-thumb fingers extended.
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) return 1; // Paper
    
    // Scissors: Index and Middle extended. Ring and Pinky curled. Use strict check.
    if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) return 2; // Scissors
    
    return -1; // Unknown/Transition
}

// --- Game Logic ---

function getComputerMove() {
    const difficulty = aiDifficultySelect.value;
    
    if (difficulty === 'random' || moveHistory.length === 0) {
        return Math.floor(Math.random() * 3); // 0, 1, 2
    }
    
    // Smart AI
    // 30% random to avoid being predictable
    if (Math.random() < 0.3) {
        return Math.floor(Math.random() * 3);
    }
    
    // Predict player's next move based on LAST move
    if (lastPlayerMove === null) return Math.floor(Math.random() * 3);

    const history = markovChain[getMoveName(lastPlayerMove)];
    // Find most likely next move
    let predictedMove = 'Rock';
    let maxCount = -1;
    
    // If all 0, random
    if (history['Rock'] === 0 && history['Paper'] === 0 && history['Scissors'] === 0) {
        return Math.floor(Math.random() * 3);
    }

    for (const move in history) {
        if (history[move] > maxCount) {
            maxCount = history[move];
            predictedMove = move;
        }
    }
    
    // Counter the predicted move
    // If we predict player throws Rock, we throw Paper (1).
    if (predictedMove === 'Rock') return 1; // Counter Rock with Paper
    if (predictedMove === 'Paper') return 2; // Counter Paper with Scissors
    if (predictedMove === 'Scissors') return 0; // Counter Scissors with Rock
    
    return 0; // Fallback
}

function getMoveName(moveCode) {
    if (moveCode === 0) return 'Rock';
    if (moveCode === 1) return 'Paper';
    if (moveCode === 2) return 'Scissors';
    return '?';
}

function getMoveEmoji(moveCode) {
    if (moveCode === 0) return '✊';
    if (moveCode === 1) return '🖐️';
    if (moveCode === 2) return '✌️';
    return '?';
}

function logBattle(pMove, aiMove, result) {
    const li = document.createElement('li');
    li.innerHTML = `<span style="color:#aaa">R${roundCount}:</span> ${getMoveEmoji(pMove)} vs ${getMoveEmoji(aiMove)} - <b>${result}</b>`;
    battleLogEl.prepend(li);
}

function updateStats(result) {
    if (result === 'WIN') stats.win++;
    if (result === 'LOSE') stats.loss++;
    if (result === 'DRAW') stats.draw++;
    
    statsChart.data.datasets[0].data = [stats.win, stats.loss, stats.draw];
    statsChart.update();
}

function endGame() {
    currentState = STATE.IDLE;
    playHandBtn.disabled = true;
    startBtn.disabled = false; // Allow restart via main button too
    startBtn.innerText = "重新開始";
    
    gameOverModal.classList.remove('hidden');
    
    if (playerScore > aiScore) {
        finalResultTitle.textContent = "VICTORY!";
        finalResultTitle.style.background = "linear-gradient(to right, #22c55e, #86efac)";
        finalResultTitle.style.webkitBackgroundClip = "text";
        playWinSound();
    } else {
        finalResultTitle.textContent = "DEFEAT";
        finalResultTitle.style.background = "linear-gradient(to right, #ef4444, #fca5a5)";
        finalResultTitle.style.webkitBackgroundClip = "text";
        playLoseSound();
    }
    finalScoreText.textContent = `${playerScore} - ${aiScore}`;
}

function evaluateRound() {
    // Snapshot the stable gesture
    const pMove = stableGesture;
    const aiMove = getComputerMove();
    
    // Update Markov Chain with this transition (if not first move)
    if (lastPlayerMove !== null) {
        const prevName = getMoveName(lastPlayerMove);
        const currName = getMoveName(pMove);
        markovChain[prevName][currName]++;
    }
    lastPlayerMove = pMove;
    moveHistory.push(pMove);

    // Determine Winner
    // 0: Rock, 1: Paper, 2: Scissors
    // Rules: 0 beats 2, 1 beats 0, 2 beats 1
    let result = "DRAW";
    
    if (pMove === aiMove) {
        result = "DRAW";
        playDrawSound();
    } else if (
        (pMove === 0 && aiMove === 2) || // Rock beats Scissors
        (pMove === 1 && aiMove === 0) || // Paper beats Rock
        (pMove === 2 && aiMove === 1)    // Scissors beats Paper
    ) {
        result = "WIN";
        playerScore++;
        playWinSound();
    } else {
        result = "LOSE";
        aiScore++;
        playLoseSound();
    }
    
    // UI Updates
    playerScoreEl.innerText = playerScore;
    aiScoreEl.innerText = aiScore;
    pMoveIcon.innerText = getMoveEmoji(pMove);
    aiMoveIcon.innerText = getMoveEmoji(aiMove);
    
    resultText.innerText = result;
    resultText.className = 'result-text ' + result.toLowerCase();
    
    logBattle(pMove, aiMove, result);
    updateStats(result);
    
    // Show Result Overlay
    resultOverlay.classList.remove('hidden');
    
    // Check Game Over
    if (result !== "DRAW") {
        if (playerScore >= targetWins || aiScore >= targetWins) {
            setTimeout(endGame, 2000);
            return;
        }
        roundCount++;
        currentRoundEl.innerText = roundCount;
    }
    
    // Auto-proceed or wait?
    // Let's go back to DETECTING after a short delay
    setTimeout(() => {
        resultOverlay.classList.add('hidden');
        startCountdown();
    }, 2000);
}


// --- Main Loops ---

function startCountdown() {
    currentState = STATE.COUNTDOWN;
    playHandBtn.disabled = true;
    let count = 3;
    countdownOverlay.innerText = count;
    countdownOverlay.classList.remove('hidden');
    playCountdownSound();
    
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownOverlay.innerText = count;
            playCountdownSound();
        } else {
            clearInterval(interval);
            countdownOverlay.classList.add('hidden');
            currentState = STATE.DETECTING;
            // Allow manual trigger if detection fails, or just rely on auto
            playHandBtn.disabled = false; 
            playHandBtn.innerText = "偵測中...";
        }
    }, 1000);
}

function startGame() {
    // Reset Stats
    playerScore = 0;
    aiScore = 0;
    roundCount = 1;
    stats = { win: 0, loss: 0, draw: 0 };
    statsChart.data.datasets[0].data = [0,0,0];
    statsChart.update();
    playerScoreEl.innerText = '0';
    aiScoreEl.innerText = '0';
    currentRoundEl.innerText = '1';
    battleLogEl.innerHTML = '';
    
    targetWins = parseInt(winningScoreInput.value) || 3;
    
    startBtn.disabled = true;
    startBtn.innerText = "遊戲進行中";
    
    // Start Camera
    if (!camera) {
        camera = new Camera(videoElement, {
            onFrame: async () => {
                await hands.send({image: videoElement});
            },
            width: 1280,
            height: 720
        });
        camera.start();
    }
    
    startCountdown();
}

// MediaPipe Loop
function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    const w = canvasElement.width;
    const h = canvasElement.height;
    
    if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS,
                           {color: '#00FF00', lineWidth: 5});
            drawLandmarks(canvasCtx, landmarks, {color: '#FF0000', lineWidth: 2});
            
            // Logic
            if (currentState === STATE.DETECTING) {
                // Detect Gesture
                const detected = detectGesture(landmarks);
                
                if (detected !== -1) {
                    if (detected === stableGesture) {
                        stableCount++;
                    } else {
                        stableGesture = detected;
                        stableCount = 0;
                    }
                    
                    // Box around hand
                    const xList = landmarks.map(l => l.x);
                    const yList = landmarks.map(l => l.y);
                    const xMin = Math.min(...xList) * w;
                    const xMax = Math.max(...xList) * w;
                    const yMin = Math.min(...yList) * h;
                    const yMax = Math.max(...yList) * h;
                    
                    canvasCtx.strokeStyle = '#00FFFF';
                    canvasCtx.lineWidth = 4;
                    canvasCtx.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
                    
                    // Show label above hand
                    canvasCtx.font = "30px Arial";
                    canvasCtx.fillStyle = "#00FFFF";
                    canvasCtx.fillText(getMoveName(detected), xMin, yMin - 10);

                    // Confirm trigger (require 10 frames of stability ~0.3s)
                    if (stableCount > 10) {
                        currentState = STATE.RESULT;
                        evaluateRound();
                    }
                } else {
                    stableCount = 0;
                }
            }
        }
    }
    canvasCtx.restore();
}

// --- Initialization ---
const hands = new Hands({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});
hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5
});
hands.onResults(onResults);

let camera = null;

// Controls
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', () => {
    gameOverModal.classList.add('hidden');
    startGame();
});

// Update settings
winningScoreInput.addEventListener('change', (e) => {
    maxWinsDisplay.innerText = e.target.value;
});

// Resize canvas
function resizeCanvas() {
    canvasElement.width = videoElement.videoWidth || 800; // Default
    canvasElement.height = videoElement.videoHeight || 450;
}
videoElement.addEventListener('loadedmetadata', resizeCanvas);
window.addEventListener('resize', resizeCanvas);
