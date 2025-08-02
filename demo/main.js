// Mock implementation of the intelligent queue for demo purposes
// In a real implementation, this would import from the actual library

class MockLLMThrottle {
    constructor(config) {
        this.config = config;
        this.used = { rpm: 0, tpm: 0 };
        this.lastReset = Date.now();
    }

    canProcess(tokens) {
        this.resetIfNeeded();
        
        const rpmOk = this.used.rpm < this.config.rpm;
        const tpmOk = this.used.tpm + tokens <= this.config.tpm;
        
        if (!rpmOk) {
            return { 
                allowed: false, 
                reason: 'rpm_limit',
                availableTokens: { rpm: this.config.rpm - this.used.rpm, tpm: this.config.tpm - this.used.tpm }
            };
        }
        
        if (!tpmOk) {
            return { 
                allowed: false, 
                reason: 'tpm_limit',
                availableTokens: { rpm: this.config.rpm - this.used.rpm, tpm: this.config.tpm - this.used.tpm }
            };
        }
        
        return { 
            allowed: true,
            availableTokens: { rpm: this.config.rpm - this.used.rpm, tpm: this.config.tpm - this.used.tpm }
        };
    }

    consume(tokens) {
        this.resetIfNeeded();
        this.used.rpm += 1;
        this.used.tpm += tokens;
        return true;
    }

    getMetrics() {
        this.resetIfNeeded();
        return {
            rpm: {
                used: this.used.rpm,
                available: this.config.rpm - this.used.rpm,
                limit: this.config.rpm,
                percentage: (this.used.rpm / this.config.rpm) * 100
            },
            tpm: {
                used: this.used.tpm,
                available: this.config.tpm - this.used.tpm,
                limit: this.config.tpm,
                percentage: (this.used.tpm / this.config.tpm) * 100
            },
            efficiency: 0.85,
            consumptionHistory: {
                count: 0,
                averageTokensPerRequest: 0,
                totalTokens: 0,
                estimationAccuracy: 1
            },
            memory: {
                historyRecords: 0,
                estimatedMemoryUsage: 0,
                maxHistoryRecords: 1000
            },
            compensation: {
                totalDebt: 0,
                pendingCompensation: 0
            }
        };
    }

    resetIfNeeded() {
        const now = Date.now();
        if (now - this.lastReset >= 60000) { // Reset every minute
            this.used = { rpm: 0, tpm: 0 };
            this.lastReset = now;
        }
    }
}

class MockLLMQueueDispatcher {
    constructor(config = {}) {
        this.config = config;
        this.messages = [];
        this.processing = [];
        this.completed = [];
        this.messageCounter = 0;
        this.isAutoProcessing = false;
        this.metrics = {
            totalMessages: 0,
            completedCount: 0,
            startTime: Date.now()
        };
    }

    async enqueue(request) {
        const message = {
            id: `msg-${++this.messageCounter}`,
            payload: request,
            attributes: {
                enqueuedAt: new Date(),
                receiveCount: 0
            },
            score: null
        };
        
        this.messages.push(message);
        this.metrics.totalMessages++;
        
        log('info', `Enqueued message ${message.id} with priority ${this.getPriorityName(request.priority)}`);
        return message;
    }

    async dequeue(rateLimiter) {
        if (this.messages.length === 0) return null;

        // Calculate scores for all messages
        for (const message of this.messages) {
            message.score = this.calculateScore(message, rateLimiter);
        }

        // Sort by score (highest first)
        this.messages.sort((a, b) => b.score.total - a.score.total);

        // Find first message that can be processed
        for (let i = 0; i < this.messages.length; i++) {
            const message = this.messages[i];
            const canProcess = rateLimiter.canProcess(message.payload.tokenInfo.estimated);
            
            if (canProcess.allowed) {
                // Remove from pending and add to processing
                this.messages.splice(i, 1);
                this.processing.push(message);
                
                rateLimiter.consume(message.payload.tokenInfo.estimated);
                
                return {
                    message,
                    markAsProcessed: async () => {
                        const index = this.processing.findIndex(m => m.id === message.id);
                        if (index !== -1) {
                            this.processing.splice(index, 1);
                            this.completed.push({
                                ...message,
                                completedAt: new Date()
                            });
                            this.metrics.completedCount++;
                            log('info', `Message ${message.id} processed successfully`);
                        }
                    },
                    markAsFailed: async (error) => {
                        const index = this.processing.findIndex(m => m.id === message.id);
                        if (index !== -1) {
                            this.processing.splice(index, 1);
                            // Put back in queue with increased receive count
                            message.attributes.receiveCount++;
                            this.messages.push(message);
                            log('error', `Message ${message.id} failed: ${error.message}`);
                        }
                    }
                };
            }
        }

        return null;
    }

    calculateScore(message, rateLimiter) {
        const metrics = rateLimiter.getMetrics();
        const now = Date.now();
        const waitTime = now - message.attributes.enqueuedAt.getTime();
        
        // Priority score (0-1)
        const priorityScore = this.calculatePriorityScore(message.payload.priority);
        
        // Wait time score (0-1)
        const waitTimeScore = Math.min(waitTime / 60000, 1); // Max 1 minute
        
        // Efficiency score (0-1)
        const tokens = message.payload.tokenInfo.estimated;
        const available = metrics.tpm.available;
        const efficiencyScore = available > 0 ? Math.min(tokens / (available * 0.8), 1) : 0;
        
        // Retry penalty
        const retryPenalty = Math.max(0.1, Math.pow(0.7, message.attributes.receiveCount));
        
        // Token fit score
        const tokenFitScore = available > 0 && tokens <= available ? 1 : 0;
        
        // Apply weights based on queue type
        const weights = this.getWeights();
        
        const breakdown = {
            priority: priorityScore * weights.priority,
            waitTime: waitTimeScore * weights.waitTime,
            efficiency: efficiencyScore * weights.efficiency,
            retry: retryPenalty * weights.retry,
            tokenFit: tokenFitScore * weights.tokenFit,
            processingTime: 0.5 * weights.processingTime
        };
        
        const total = Object.values(breakdown).reduce((sum, score) => sum + score, 0);
        
        return { total, breakdown };
    }

    calculatePriorityScore(priority) {
        const scores = [1.0, 0.7, 0.4, 0.1]; // URGENT, HIGH, NORMAL, LOW
        return scores[priority] || 0.1;
    }

    getWeights() {
        const queueType = document.getElementById('queueType').value;
        
        switch (queueType) {
            case 'simple':
                return { priority: 0.8, waitTime: 0.1, efficiency: 0.05, retry: 0.05, tokenFit: 0, processingTime: 0 };
            case 'throughput':
                return { priority: 0.15, waitTime: 0.1, efficiency: 0.35, retry: 0.05, tokenFit: 0.25, processingTime: 0.1 };
            case 'fair':
                return { priority: 0.2, waitTime: 0.5, efficiency: 0.1, retry: 0.15, tokenFit: 0.05, processingTime: 0 };
            default:
                return { priority: 0.25, waitTime: 0.2, efficiency: 0.2, retry: 0.1, tokenFit: 0.15, processingTime: 0.1 };
        }
    }

    getPriorityName(priority) {
        const names = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
        return names[priority] || 'UNKNOWN';
    }

    async getQueueMetrics() {
        const now = Date.now();
        const elapsed = (now - this.metrics.startTime) / 1000 / 60; // minutes
        const throughput = elapsed > 0 ? this.metrics.completedCount / elapsed : 0;
        
        return {
            queue: {
                totalMessages: this.messages.length,
                approximateNumberOfMessages: this.messages.length,
                approximateNumberOfMessagesInFlight: this.processing.length
            },
            processing: {
                activeRequests: this.processing.length
            },
            performance: {
                throughput: Math.round(throughput * 10) / 10,
                bufferUtilization: this.messages.length / 50, // Assuming buffer size of 50
                averageWaitTime: this.calculateAverageWaitTime()
            }
        };
    }

    calculateAverageWaitTime() {
        if (this.completed.length === 0) return 0;
        
        const totalWaitTime = this.completed.reduce((sum, msg) => {
            return sum + (msg.completedAt.getTime() - msg.attributes.enqueuedAt.getTime());
        }, 0);
        
        return Math.round(totalWaitTime / this.completed.length);
    }

    purge() {
        this.messages = [];
        this.processing = [];
        this.completed = [];
        this.metrics = {
            totalMessages: 0,
            completedCount: 0,
            startTime: Date.now()
        };
        log('info', 'Queue purged');
    }
}

// Global state
let queue;
let rateLimiter;
let autoProcessInterval;

// Initialize demo
document.addEventListener('DOMContentLoaded', () => {
    initializeDemo();
    setupEventListeners();
    startMetricsUpdate();
});

function initializeDemo() {
    // Initialize rate limiter
    rateLimiter = new MockLLMThrottle({
        rpm: parseInt(document.getElementById('rpm').value),
        tpm: parseInt(document.getElementById('tpm').value)
    });

    // Initialize queue
    queue = new MockLLMQueueDispatcher({
        bufferSize: parseInt(document.getElementById('bufferSize').value),
        enablePrefetch: document.getElementById('enablePrefetch').checked
    });

    log('info', 'Demo initialized with in-memory queue and rate limiter');
}

function setupEventListeners() {
    // Buffer size slider
    const bufferSize = document.getElementById('bufferSize');
    const bufferSizeValue = document.getElementById('bufferSizeValue');
    bufferSize.addEventListener('input', (e) => {
        bufferSizeValue.textContent = e.target.value;
    });

    // Rate limiter updates
    document.getElementById('rpm').addEventListener('change', updateRateLimiter);
    document.getElementById('tpm').addEventListener('change', updateRateLimiter);

    // Queue type change
    document.getElementById('queueType').addEventListener('change', () => {
        log('info', `Queue type changed to: ${document.getElementById('queueType').value}`);
    });

    // Message controls
    document.getElementById('addMessage').addEventListener('click', addMessage);
    document.getElementById('addBatch').addEventListener('click', addBatch);

    // Processing controls
    document.getElementById('processNext').addEventListener('click', processNext);
    document.getElementById('autoProcess').addEventListener('click', startAutoProcess);
    document.getElementById('pauseProcess').addEventListener('click', pauseAutoProcess);
    document.getElementById('clearQueue').addEventListener('click', clearQueue);

    // Log controls
    document.getElementById('clearLog').addEventListener('click', clearLog);
}

function updateRateLimiter() {
    const rpm = parseInt(document.getElementById('rpm').value);
    const tpm = parseInt(document.getElementById('tpm').value);
    
    rateLimiter = new MockLLMThrottle({ rpm, tpm });
    log('info', `Rate limiter updated: ${rpm} RPM, ${tpm} TPM`);
}

async function addMessage() {
    const messageText = document.getElementById('messageText').value.trim();
    const priority = parseInt(document.getElementById('priority').value);
    const estimatedTokens = parseInt(document.getElementById('estimatedTokens').value);

    if (!messageText) {
        log('warn', 'Message text is required');
        return;
    }

    const request = {
        id: `req-${Date.now()}`,
        payload: { prompt: messageText },
        priority,
        tokenInfo: { estimated: estimatedTokens },
        createdAt: new Date()
    };

    await queue.enqueue(request);
    
    // Clear form
    document.getElementById('messageText').value = '';
    document.getElementById('estimatedTokens').value = '100';

    updateDisplay();
}

async function addBatch() {
    const priorities = [0, 1, 2, 2, 3]; // Mix of priorities
    const prompts = [
        'Analyze this data for trends',
        'Generate a summary report',
        'Translate this text to Spanish',
        'Write a brief explanation',
        'Review and provide feedback'
    ];

    for (let i = 0; i < 5; i++) {
        const request = {
            id: `batch-req-${Date.now()}-${i}`,
            payload: { prompt: prompts[i] },
            priority: priorities[i],
            tokenInfo: { estimated: 50 + Math.floor(Math.random() * 200) },
            createdAt: new Date()
        };

        await queue.enqueue(request);
    }

    log('info', 'Added batch of 5 messages');
    updateDisplay();
}

async function processNext() {
    const processable = await queue.dequeue(rateLimiter);
    
    if (!processable) {
        log('warn', 'No messages available for processing');
        updateDisplay();
        return;
    }

    const message = processable.message;
    log('info', `Processing message ${message.id}...`);
    
    // Simulate processing time
    setTimeout(async () => {
        try {
            // Simulate occasional failures
            if (Math.random() < 0.1) {
                throw new Error('Simulated processing error');
            }
            
            await processable.markAsProcessed();
            updateDisplay();
        } catch (error) {
            await processable.markAsFailed(error);
            updateDisplay();
        }
    }, 1000 + Math.random() * 2000); // 1-3 seconds

    updateDisplay();
}

function startAutoProcess() {
    if (autoProcessInterval) return;
    
    autoProcessInterval = setInterval(processNext, 2000);
    log('info', 'Auto-processing started');
    
    document.getElementById('autoProcess').disabled = true;
    document.getElementById('pauseProcess').disabled = false;
}

function pauseAutoProcess() {
    if (autoProcessInterval) {
        clearInterval(autoProcessInterval);
        autoProcessInterval = null;
        log('info', 'Auto-processing paused');
    }
    
    document.getElementById('autoProcess').disabled = false;
    document.getElementById('pauseProcess').disabled = true;
}

function clearQueue() {
    pauseAutoProcess();
    queue.purge();
    updateDisplay();
}

function updateDisplay() {
    updateQueueDisplay();
    updateMetrics();
    updateRateMeters();
}

function updateQueueDisplay() {
    // Pending messages
    const pendingContainer = document.getElementById('pendingMessages');
    pendingContainer.innerHTML = '';
    
    queue.messages.forEach(message => {
        const element = createMessageElement(message);
        pendingContainer.appendChild(element);
    });

    // Processing messages
    const processingContainer = document.getElementById('processingMessages');
    processingContainer.innerHTML = '';
    
    queue.processing.forEach(message => {
        const element = createMessageElement(message, true);
        processingContainer.appendChild(element);
    });

    // Completed messages (show last 10)
    const completedContainer = document.getElementById('completedMessages');
    completedContainer.innerHTML = '';
    
    const recentCompleted = queue.completed.slice(-10).reverse();
    recentCompleted.forEach(message => {
        const element = createMessageElement(message);
        completedContainer.appendChild(element);
    });
}

function createMessageElement(message, isProcessing = false) {
    const div = document.createElement('div');
    div.className = `message-item priority-${message.payload.priority}${isProcessing ? ' processing-animation' : ''}`;
    div.onclick = () => showScoreDetails(message);

    const priorityNames = ['🔴 URGENT', '🟡 HIGH', '🟢 NORMAL', '🔵 LOW'];
    
    div.innerHTML = `
        <div class="message-header">
            <span class="message-id">${message.id}</span>
            <span class="message-priority">${priorityNames[message.payload.priority]}</span>
        </div>
        <div class="message-content">${message.payload.payload.prompt}</div>
        <div class="message-tokens">${message.payload.tokenInfo.estimated} tokens</div>
        ${message.score ? `<div class="message-tokens">Score: ${message.score.total.toFixed(3)}</div>` : ''}
    `;

    return div;
}

function showScoreDetails(message) {
    const container = document.getElementById('scoringDetails');
    
    if (!message.score) {
        container.innerHTML = '<p>No scoring information available for this message</p>';
        return;
    }

    const { total, breakdown } = message.score;
    
    container.innerHTML = `
        <h3>Scoring for ${message.id}</h3>
        <p><strong>Total Score:</strong> ${total.toFixed(3)}</p>
        <div class="score-breakdown">
            ${Object.entries(breakdown).map(([key, value]) => `
                <div class="score-item">
                    <div class="score-name">${key.charAt(0).toUpperCase() + key.slice(1)}</div>
                    <div class="score-value">${value.toFixed(3)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

async function updateMetrics() {
    const metrics = await queue.getQueueMetrics();
    const rateLimiterMetrics = rateLimiter.getMetrics();
    
    document.getElementById('totalMessages').textContent = metrics.queue.totalMessages;
    document.getElementById('activeRequests').textContent = metrics.processing.activeRequests;
    document.getElementById('throughput').textContent = metrics.performance.throughput;
    document.getElementById('bufferUtilization').textContent = `${Math.round(metrics.performance.bufferUtilization * 100)}%`;
    document.getElementById('avgWaitTime').textContent = `${metrics.performance.averageWaitTime}ms`;
    document.getElementById('efficiency').textContent = `${Math.round(rateLimiterMetrics.efficiency * 100)}%`;
}

function updateRateMeters() {
    const metrics = rateLimiter.getMetrics();
    
    const rpmMeter = document.getElementById('rpmMeter');
    const tpmMeter = document.getElementById('tpmMeter');
    
    rpmMeter.style.setProperty('--usage', `${metrics.rpm.percentage}%`);
    tpmMeter.style.setProperty('--usage', `${metrics.tpm.percentage}%`);
}

function startMetricsUpdate() {
    setInterval(updateDisplay, 1000);
}

function log(level, message) {
    const logOutput = document.getElementById('logOutput');
    const timestamp = new Date().toLocaleTimeString();
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
        <span class="log-timestamp">${timestamp}</span>
        <span class="log-level ${level}">${level.toUpperCase()}</span>
        ${message}
    `;
    
    logOutput.appendChild(entry);
    
    // Auto-scroll if enabled
    if (document.getElementById('autoScroll').checked) {
        logOutput.scrollTop = logOutput.scrollHeight;
    }
    
    // Keep only last 100 entries
    while (logOutput.children.length > 100) {
        logOutput.removeChild(logOutput.firstChild);
    }
}

function clearLog() {
    document.getElementById('logOutput').innerHTML = '';
}