// --- State Management ---
const STATE_KEY = 'wakebet_state';
const DEFAULT_STATE = {
    credits: 1000,
    stats: { total: 0, successes: 0, failures: 0, won: 0, lost: 0 },
    activeCommitments: [] // Array of { id: number, time: 'HH:MM', deposit: 100 }
};

let state = JSON.parse(localStorage.getItem(STATE_KEY)) || DEFAULT_STATE;

// Migration: If old state has a single activeCommitment, migrate to activeCommitments array
if (state.activeCommitment) {
    state.activeCommitments = [{
        id: Date.now(),
        time: state.activeCommitment.time,
        deposit: state.activeCommitment.deposit
    }];
    delete state.activeCommitment;
    saveState();
} else if (!state.activeCommitments) {
    state.activeCommitments = [];
    saveState();
}

let timerInterval = null;
let challengeQueue = [];
let activeChallengeCommitment = null;
let isChallengeActive = false;
let globalChallengeTimer = null;
let challengeTimeRemaining = 60;

// --- DOM Elements ---
const views = {
    dashboard: document.getElementById('dashboard-view'),
    commitment: document.getElementById('commitment-view'),
    challenge: document.getElementById('challenge-view'),
    stats: document.getElementById('stats-view')
};

const elWalletBalance = document.getElementById('wallet-balance');
const elCommitmentsList = document.getElementById('active-commitments-list');

// --- Initialization ---
function init() {
    updateWalletDisplay();
    startCountdownTimer();
    setupEventListeners();
}

function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    updateWalletDisplay();
}

function updateWalletDisplay() {
    elWalletBalance.textContent = state.credits;
    document.getElementById('max-deposit').textContent = state.credits;
    document.getElementById('deposit-amount').max = state.credits;
}

function switchView(viewName) {
    Object.values(views).forEach(v => {
        v.classList.remove('active');
    });
    views[viewName].classList.add('active');
}

// --- Event Listeners ---
function setupEventListeners() {
    // Navigation
    document.getElementById('btn-new-commitment').addEventListener('click', () => {
        // Only allow new commitment if not in a challenge
        if (isChallengeActive) return;
        switchView('commitment');
    });
    document.getElementById('btn-cancel-commitment').addEventListener('click', () => switchView('dashboard'));
    document.getElementById('btn-view-stats').addEventListener('click', showStats);
    document.getElementById('btn-back-stats').addEventListener('click', () => switchView('dashboard'));
    
    document.getElementById('btn-add-credits').addEventListener('click', () => {
        const input = window.prompt("How many credits would you like to add?");
        const amount = parseInt(input, 10);
        if (!isNaN(amount) && amount > 0) {
            state.credits += amount;
            saveState();
        } else if (input !== null) {
            alert("Please enter a valid number greater than 0.");
        }
    });
    
    // Form Submission
    document.getElementById('commitment-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const time = document.getElementById('wake-time').value;
        const deposit = parseInt(document.getElementById('deposit-amount').value, 10);
        
        if (deposit > state.credits) {
            alert("You don't have enough credits!");
            return;
        }

        // Deduct deposit and save commitment
        state.credits -= deposit;
        state.activeCommitments.push({
            id: Date.now(),
            time, 
            deposit
        });
        saveState();
        
        switchView('dashboard');
        renderCommitments();
    });

    document.getElementById('btn-finish-challenge').addEventListener('click', () => {
        checkChallengeQueue();
    });
}

// --- Countdown Logic ---
function startCountdownTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    renderCommitments();
    
    timerInterval = setInterval(() => {
        const now = new Date();
        let triggers = [];
        
        // Check each commitment
        for (let i = state.activeCommitments.length - 1; i >= 0; i--) {
            const commitment = state.activeCommitments[i];
            const [hours, minutes] = commitment.time.split(':').map(Number);
            
            let target = new Date();
            target.setHours(hours, minutes, 0, 0);
            
            // If target time is in the past, it's for tomorrow
            if (now > target) {
                target.setDate(target.getDate() + 1);
            }
            
            const diff = target - now;
            
            // Trigger challenge if time is up (within 1 second)
            if (diff <= 1000 && diff >= 0) {
                triggers.push(commitment);
                state.activeCommitments.splice(i, 1);
            } else {
                // Update specific countdown display if it exists
                const countdownEl = document.getElementById(`countdown-${commitment.id}`);
                if (countdownEl) {
                    const h = Math.floor((diff / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
                    const m = Math.floor((diff / 1000 / 60) % 60).toString().padStart(2, '0');
                    const s = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
                    countdownEl.textContent = `${h}:${m}:${s}`;
                }
            }
        }
        
        if (triggers.length > 0) {
            saveState();
            renderCommitments();
            
            // Add triggered commitments to queue
            triggers.forEach(c => challengeQueue.push(c));
            
            // Start if not already active
            if (!isChallengeActive) {
                checkChallengeQueue();
            }
        }
        
    }, 1000);
}

function renderCommitments() {
    elCommitmentsList.innerHTML = '';
    
    if (state.activeCommitments.length === 0) {
        return;
    }
    
    state.activeCommitments.forEach(commitment => {
        const item = document.createElement('div');
        item.className = 'commitment-item';
        item.innerHTML = `
            <div class="commitment-info">
                <h3>Wake up at ${commitment.time}</h3>
                <p>${commitment.deposit} credits locked</p>
            </div>
            <div class="countdown" id="countdown-${commitment.id}">--:--:--</div>
        `;
        elCommitmentsList.appendChild(item);
    });
}

// --- Challenge Flow ---
let currentChallengeResults = [];

function checkChallengeQueue() {
    if (challengeQueue.length > 0) {
        activeChallengeCommitment = challengeQueue.shift();
        startMorningChallenge();
    } else {
        isChallengeActive = false;
        activeChallengeCommitment = null;
        switchView('dashboard');
    }
}

function startMorningChallenge() {
    isChallengeActive = true;
    switchView('challenge');
    
    document.getElementById('game-reaction').classList.add('hidden');
    document.getElementById('game-odd').classList.add('hidden');
    document.getElementById('game-typing').classList.add('hidden');
    document.getElementById('challenge-results').classList.add('hidden');
    document.getElementById('game-memory').classList.remove('hidden');
    
    currentChallengeResults = [];
    resetDots();
    startChallengeTimer();
    startMemoryGame();
}

function startChallengeTimer() {
    challengeTimeRemaining = 60;
    const timerEl = document.getElementById('challenge-timer');
    timerEl.textContent = challengeTimeRemaining;
    timerEl.classList.remove('warning');
    
    if (globalChallengeTimer) clearInterval(globalChallengeTimer);
    
    globalChallengeTimer = setInterval(() => {
        challengeTimeRemaining--;
        timerEl.textContent = challengeTimeRemaining;
        
        if (challengeTimeRemaining <= 10) {
            timerEl.classList.add('warning');
        }
        
        if (challengeTimeRemaining <= 0) {
            clearInterval(globalChallengeTimer);
            handleChallengeTimeout();
        }
    }, 1000);
}

function handleChallengeTimeout() {
    // Fill remaining games with failures
    while (currentChallengeResults.length < 5) {
        updateProgress(false);
    }
    finishChallenge();
}

function updateProgress(pass) {
    const dot = document.getElementById(`dot-${currentChallengeResults.length + 1}`);
    dot.classList.add(pass ? 'pass' : 'fail');
    currentChallengeResults.push(pass);
}

function resetDots() {
    [1, 2, 3, 4, 5].forEach(i => {
        const dot = document.getElementById(`dot-${i}`);
        if(dot) dot.className = 'dot';
    });
}

function finishChallenge() {
    if (globalChallengeTimer) clearInterval(globalChallengeTimer);
    
    document.getElementById('game-memory').classList.add('hidden');
    document.getElementById('game-math').classList.add('hidden');
    document.getElementById('game-typing').classList.add('hidden');
    document.getElementById('game-odd').classList.add('hidden');
    document.getElementById('game-reaction').classList.add('hidden');
    document.getElementById('challenge-results').classList.remove('hidden');
    
    const passes = currentChallengeResults.filter(r => r).length;
    const isSuccess = passes >= 3; // Pass rate >= 60% (3 out of 5)
    const deposit = activeChallengeCommitment.deposit;
    
    state.stats.total++;
    
    const titleEl = document.getElementById('result-title');
    const detailsEl = document.getElementById('result-details');
    
    let nextMsg = challengeQueue.length > 0 ? `<p><strong>Note: Another challenge is queued!</strong></p>` : '';
    document.getElementById('btn-finish-challenge').textContent = challengeQueue.length > 0 ? "Start Next Challenge" : "Return to Dashboard";
    
    if (isSuccess) {
        titleEl.textContent = "Wake-up Success!";
        titleEl.className = "text-success";
        detailsEl.innerHTML = `<p>You passed ${passes}/5 games.</p><p>Your deposit of ${deposit} credits has been returned.</p>${nextMsg}`;
        
        state.credits += deposit; 
        state.stats.successes++;
        state.stats.won += deposit;
    } else {
        titleEl.textContent = "Wake-up Failure";
        titleEl.className = "text-danger";
        detailsEl.innerHTML = `<p>You passed ${passes}/5 games.</p><p>You lost your deposit of ${deposit} credits.</p>${nextMsg}`;
        
        state.stats.failures++;
        state.stats.lost += deposit;
    }
    
    saveState();
}

// --- Game 1: Memory (4 Pairs) ---
const emojis = ['🌞', '☕', '🍳', '⏰'];
let memoryCards = [];
let flippedCards = [];
let matchedPairs = 0;

function startMemoryGame() {
    document.getElementById('game-memory').classList.remove('hidden');
    document.getElementById('game-math').classList.add('hidden');
    document.getElementById('game-reaction').classList.add('hidden');
    document.getElementById('challenge-results').classList.add('hidden');
    
    const grid = document.getElementById('memory-grid');
    grid.innerHTML = '';
    matchedPairs = 0;
    flippedCards = [];
    
    memoryCards = [...emojis, ...emojis].sort(() => Math.random() - 0.5);
    
    memoryCards.forEach((emoji, index) => {
        const card = document.createElement('div');
        card.className = 'memory-card';
        card.dataset.emoji = emoji;
        card.dataset.index = index;
        card.textContent = '❓'; 
        card.addEventListener('click', handleCardClick);
        grid.appendChild(card);
    });
}

function handleCardClick(e) {
    const card = e.target;
    if (card.classList.contains('flipped') || card.classList.contains('matched') || flippedCards.length === 2) return;
    
    card.classList.add('flipped');
    card.textContent = card.dataset.emoji;
    flippedCards.push(card);
    
    if (flippedCards.length === 2) {
        setTimeout(checkMatch, 1000);
    }
}

function checkMatch() {
    const [c1, c2] = flippedCards;
    if (c1.dataset.emoji === c2.dataset.emoji) {
        c1.classList.add('matched');
        c2.classList.add('matched');
        matchedPairs++;
        if (matchedPairs === 4) {
            updateProgress(true); // Pass
            setTimeout(() => {
                document.getElementById('game-memory').classList.add('hidden');
                startMathGame();
            }, 1000);
        }
    } else {
        c1.classList.remove('flipped');
        c2.classList.remove('flipped');
        c1.textContent = '❓';
        c2.textContent = '❓';
    }
    flippedCards = [];
}

// --- Game 2: Math (3 problems) ---
let mathProblemsCompleted = 0;
let currentAnswer = 0;

function startMathGame() {
    document.getElementById('game-math').classList.remove('hidden');
    mathProblemsCompleted = 0;
    generateMathProblem();
    
    document.getElementById('math-form').onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('math-answer');
        if (parseInt(input.value, 10) === currentAnswer) {
            mathProblemsCompleted++;
            if (mathProblemsCompleted === 3) {
                updateProgress(true); // Pass Math
                document.getElementById('game-math').classList.add('hidden');
                startTypingGame();
            } else {
                generateMathProblem();
            }
        } else {
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 300);
        }
        input.value = '';
    };
}

function generateMathProblem() {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const isAdd = Math.random() > 0.5;
    
    if (isAdd) {
        currentAnswer = a + b;
        document.getElementById('math-problem').textContent = `${a} + ${b} = ?`;
    } else {
        const max = Math.max(a, b);
        const min = Math.min(a, b);
        currentAnswer = max - min;
        document.getElementById('math-problem').textContent = `${max} - ${min} = ?`;
    }
    document.getElementById('math-progress').textContent = `Completed: ${mathProblemsCompleted}/3`;
    document.getElementById('math-answer').focus();
}

// --- Game 3: Reverse Typing (3 rounds) ---
const typingWords = ['WAKEUP', 'PRODUCTIVITY', 'COMMITMENT', 'MORNING', 'DISCIPLINE', 'ENERGY'];
let typingRoundsCompleted = 0;
let typingPasses = 0;
let currentTypingWord = '';
let currentTypingReversed = '';

function startTypingGame() {
    document.getElementById('game-typing').classList.remove('hidden');
    typingRoundsCompleted = 0;
    typingPasses = 0;
    generateTypingWord();
    
    document.getElementById('typing-form').onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('typing-answer');
        const answer = input.value.toUpperCase();
        
        if (answer === currentTypingReversed) {
            typingPasses++;
        } else {
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 300);
        }
        
        typingRoundsCompleted++;
        input.value = '';
        
        if (typingRoundsCompleted === 3) {
            updateProgress(typingPasses >= 2); // Pass Typing if 2/3 rounds perfect
            document.getElementById('game-typing').classList.add('hidden');
            startOddOneOutGame();
        } else {
            generateTypingWord();
        }
    };
}

function generateTypingWord() {
    currentTypingWord = typingWords[Math.floor(Math.random() * typingWords.length)];
    currentTypingReversed = currentTypingWord.split('').reverse().join('');
    document.getElementById('typing-word').textContent = currentTypingWord;
    document.getElementById('typing-progress').textContent = `Completed: ${typingRoundsCompleted}/3`;
    document.getElementById('typing-answer').focus();
}

// --- Game 4: Odd One Out (4 rounds) ---
const oddPairs = [
    { base: 'O', odd: '0' },
    { base: '😁', odd: '😅' },
    { base: 'p', odd: 'q' },
    { base: 'b', odd: 'd' },
    { base: 'I', odd: 'l' },
    { base: '🌟', odd: '⭐' }
];

let oddRoundsCompleted = 0;
let oddPasses = 0;

function startOddOneOutGame() {
    document.getElementById('game-odd').classList.remove('hidden');
    oddRoundsCompleted = 0;
    oddPasses = 0;
    generateOddGrid();
}

function generateOddGrid() {
    const grid = document.getElementById('odd-grid');
    grid.innerHTML = '';
    document.getElementById('odd-progress').textContent = `Completed: ${oddRoundsCompleted}/4`;
    
    const pair = oddPairs[Math.floor(Math.random() * oddPairs.length)];
    const oddIndex = Math.floor(Math.random() * 25);
    
    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'odd-icon';
        cell.textContent = (i === oddIndex) ? pair.odd : pair.base;
        
        cell.onclick = () => {
            if (i === oddIndex) {
                oddPasses++;
                nextOddRound();
            } else {
                cell.classList.add('error');
                setTimeout(() => nextOddRound(), 300);
            }
        };
        grid.appendChild(cell);
    }
}

function nextOddRound() {
    oddRoundsCompleted++;
    if (oddRoundsCompleted === 4) {
        updateProgress(oddPasses >= 3);
        document.getElementById('game-odd').classList.add('hidden');
        startReactionGame();
    } else {
        generateOddGrid();
    }
}

// --- Game 5: Reaction (<1s click) ---
let reactionTimeout;
let reactionStart;

function startReactionGame() {
    document.getElementById('game-reaction').classList.remove('hidden');
    const target = document.getElementById('reaction-target');
    const status = document.getElementById('reaction-status');
    
    target.classList.add('hidden');
    status.textContent = 'Wait for green...';
    
    const delay = Math.floor(Math.random() * 2000) + 1000;
    
    reactionTimeout = setTimeout(() => {
        const area = document.getElementById('reaction-area');
        const maxX = area.clientWidth - 80;
        const maxY = area.clientHeight - 80;
        
        target.style.left = `${Math.random() * maxX}px`;
        target.style.top = `${Math.random() * maxY}px`;
        
        target.classList.remove('hidden');
        status.textContent = 'CLICK IT!';
        reactionStart = Date.now();
        
        setTimeout(() => {
            if (!target.classList.contains('hidden')) {
                handleReactionResult(false);
            }
        }, 1500);
    }, delay);
    
    target.onclick = () => {
        const timeTaken = Date.now() - reactionStart;
        handleReactionResult(timeTaken <= 1500);
    };
}

function handleReactionResult(passed) {
    clearTimeout(reactionTimeout);
    document.getElementById('reaction-target').classList.add('hidden');
    updateProgress(passed);
    setTimeout(finishChallenge, 1000);
}

// --- Statistics ---
function showStats() {
    document.getElementById('stat-total').textContent = state.stats.total;
    document.getElementById('stat-successes').textContent = state.stats.successes;
    document.getElementById('stat-failures').textContent = state.stats.failures;
    
    const rate = state.stats.total > 0 ? Math.round((state.stats.successes / state.stats.total) * 100) : 0;
    document.getElementById('stat-rate').textContent = `${rate}%`;
    
    document.getElementById('stat-won').textContent = state.stats.won;
    document.getElementById('stat-lost').textContent = state.stats.lost;
    
    switchView('stats');
}

// Boot
init();
