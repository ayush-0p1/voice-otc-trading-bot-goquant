// static/script.js - OTC Voice Trading Bot with Exchange API Integration

let recognition = null;
let sessionId = null;
let isSessionActive = false;
let isListening = false;
let currentExchange = null;
let currentSymbol = null;
let exchangeSymbols = {};

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusDiv = document.getElementById('status');
const transcriptDiv = document.getElementById('transcript');
const clearBtn = document.getElementById('clear-transcript');

// ===== TRANSCRIPT AND STATUS FUNCTIONS =====

function addToTranscript(message) {
    const timestamp = new Date().toLocaleTimeString();
    const messageElement = document.createElement('div');
    messageElement.className = 'transcript-message';
    messageElement.innerHTML = `[${timestamp}] ${message}`;
    transcriptDiv.appendChild(messageElement);
    transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
}

function updateStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

// ===== CRYPTO TERM CORRECTION =====

function correctCryptoTerms(transcript) {
    const corrections = {
        'finance': 'binance',
        'finances': 'binance',
        'by bit': 'bybit',
        'bike': 'bybit',
        'visit': 'bybit',
        'diary bit': 'deribit',
        'kulana': 'solana',
        'ok x': 'okx',
        'bitcoin': 'BTC',
        'ethereum': 'ETH',
        'solana': 'SOL'
    };
    let corrected = transcript.toLowerCase();
    Object.entries(corrections).forEach(([wrong, right]) => {
        corrected = corrected.replace(new RegExp(`\\b${wrong}\\b`, 'gi'), right);
    });
    return corrected;
}

// ===== EXCHANGE API INTEGRATION =====

async function fetchExchangeSymbols(exchange) {
    try {
        updateStatus(`Fetching ${exchange} symbols...`, 'processing');
        const response = await fetch(`/exchanges?exchange=${exchange.toLowerCase()}`);
        const data = await response.json();
        
        if (data.success) {
            exchangeSymbols[exchange] = data.symbols;
            addToTranscript(`Loaded ${data.count} symbols from ${exchange}`);
            return data.symbols;
        } else {
            addToTranscript(`Failed to fetch ${exchange} symbols: ${data.error}`);
            return [];
        }
    } catch (error) {
        addToTranscript(`Error fetching ${exchange} symbols: ${error.message}`);
        return [];
    }
}

async function fetchSymbolPrice(exchange, symbol) {
    try {
        updateStatus(`Fetching ${symbol} price from ${exchange}...`, 'processing');
        const response = await fetch(`/price?exchange=${exchange.toLowerCase()}&symbol=${symbol.toUpperCase()}`);
        const data = await response.json();
        
        if (data.success) {
            addToTranscript(`${symbol} on ${exchange}: ${data.formatted_price}`);
            return data.price;
        } else {
            addToTranscript(`Failed to fetch ${symbol} price: ${data.error}`);
            return null;
        }
    } catch (error) {
        addToTranscript(`Error fetching price: ${error.message}`);
        return null;
    }
}

async function validateSymbol(exchange, symbol) {
    if (!exchangeSymbols[exchange]) {
        await fetchExchangeSymbols(exchange);
    }
    
    const symbols = exchangeSymbols[exchange] || [];
    const upperSymbol = symbol.toUpperCase();
    
    // Direct match
    if (symbols.includes(upperSymbol)) {
        return upperSymbol;
    }
    
    // Try with USDT suffix
    if (symbols.includes(upperSymbol + 'USDT')) {
        return upperSymbol + 'USDT';
    }
    
    // Try with USD suffix  
    if (symbols.includes(upperSymbol + 'USD')) {
        return upperSymbol + 'USD';
    }
    
    // Fuzzy search for partial matches
    const matches = symbols.filter(s => s.includes(upperSymbol));
    if (matches.length > 0) {
        addToTranscript(`🔍 Found similar symbols: ${matches.slice(0, 5).join(', ')}`);
        return matches[0]; // Return first match
    }
    
    return null;
}

// ===== EXCHANGE DETECTION AND PROCESSING =====

function detectExchange(transcript) {
    const exchanges = ['binance', 'bybit', 'okx', 'deribit'];
    const lowerTranscript = transcript.toLowerCase();
    
    for (const exchange of exchanges) {
        if (lowerTranscript.includes(exchange)) {
            return exchange;
        }
    }
    return null;
}

function detectSymbol(transcript) {
    const commonSymbols = ['btc', 'bitcoin', 'eth', 'ethereum', 'sol', 'solana', 'matic', 'usdt', 'usdc', 'bnb', 'ada', 'dot', 'link'];
    const lowerTranscript = transcript.toLowerCase();
    
    for (const symbol of commonSymbols) {
        if (lowerTranscript.includes(symbol)) {
            return symbol.toUpperCase().replace('BITCOIN', 'BTC').replace('ETHEREUM', 'ETH').replace('SOLANA', 'SOL');
        }
    }
    
    // Check for 3-4 letter uppercase patterns (likely symbols)
    const symbolMatch = transcript.match(/\b[A-Z]{3,4}\b/);
    if (symbolMatch) {
        return symbolMatch[0];
    }
    
    return null;
}

// ===== ENHANCED SPEECH PROCESSING =====

async function processUserSpeech(transcript) {
    updateStatus('Processing your request...', 'processing');
    
    // Detect exchange and symbol in transcript
    const detectedExchange = detectExchange(transcript);
    const detectedSymbol = detectSymbol(transcript);
    
    // Update current context
    if (detectedExchange) {
        currentExchange = detectedExchange;
        addToTranscript(`Exchange detected: ${currentExchange}`);
        
        // Preload symbols for this exchange
        await fetchExchangeSymbols(currentExchange);
    }
    
    if (detectedSymbol && currentExchange) {
        const validSymbol = await validateSymbol(currentExchange, detectedSymbol);
        if (validSymbol) {
            currentSymbol = validSymbol;
            addToTranscript(`Symbol detected: ${currentSymbol}`);
            
            // Fetch live price
            await fetchSymbolPrice(currentExchange, currentSymbol);
        }
    }
    
    // Send to Bland AI pathway
    const formData = new FormData();
    formData.append('transcription', transcript);
    formData.append('session_id', sessionId);
    
    try {
        const response = await fetch('/process-audio', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        
        if (data.success) {
            addToTranscript(`🤖 Bot: ${data.response_text}`);
            speakText(data.response_text);
            updateStatus('Listening...', 'listening');
        } else {
            addToTranscript(`Error: ${data.message}`);
            updateStatus('Error processing request', 'error');
        }
    } catch (error) {
        addToTranscript(`Processing error: ${error.message}`);
        updateStatus('Error processing request', 'error');
    }
}

// ===== QUICK ACTION FUNCTIONS =====

window.selectExchange = async function(exchange) {
    if (!sessionId) {
        alert('Please start a voice session first!');
        return;
    }
    
    currentExchange = exchange.toLowerCase();
    addToTranscript(`👤 You: I want to trade on ${exchange}`);
    await fetchExchangeSymbols(currentExchange);
    processUserSpeech(`I want to trade on ${exchange}`);
};

window.selectSymbol = async function(symbol) {
    if (!sessionId || !currentExchange) {
        alert('Please select an exchange first!');
        return;
    }
    
    const validSymbol = await validateSymbol(currentExchange, symbol);
    if (validSymbol) {
        currentSymbol = validSymbol;
        addToTranscript(`👤 You: I want to trade ${symbol}`);
        await fetchSymbolPrice(currentExchange, currentSymbol);
        processUserSpeech(`I want to trade ${symbol}`);
    } else {
        addToTranscript(`Symbol ${symbol} not found on ${currentExchange}`);
    }
};

// ===== TEXT-TO-SPEECH =====

function speakText(text) {
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        console.error('TTS error:', error);
    }
}

// ===== SPEECH RECOGNITION =====

function initializeSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
    } else if ('SpeechRecognition' in window) {
        recognition = new SpeechRecognition();
    } else {
        addToTranscript('Speech recognition not supported in this browser');
        return false;
    }
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = function() {
        addToTranscript('🎤 Listening... (speak now)');
        updateStatus('Listening...', 'listening');
        isListening = true;
    };

    recognition.onresult = function(event) {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const result = event.results[i];
            if (result.isFinal && result[0].confidence > 0.7) {
                finalTranscript += result[0].transcript;
            }
        }
        if (finalTranscript) {
            const corrected = correctCryptoTerms(finalTranscript);
            addToTranscript(`👤 You: ${corrected}`);
            processUserSpeech(corrected);
        }
    };

    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        addToTranscript(`Speech recognition error: ${event.error}`);
        isListening = false;
        updateStatus('Error: ' + event.error, 'error');
        
        // Try to restart on recoverable errors
        if (isSessionActive && event.error !== 'not-allowed' && event.error !== 'service-not-allowed') {
            setTimeout(() => { if (isSessionActive) recognition.start(); }, 1000);
        }
    };

    recognition.onend = function() {
        isListening = false;
        if (isSessionActive) {
            // Chrome may auto-stop after silence; restart for continuous experience
            setTimeout(() => { if (isSessionActive) recognition.start(); }, 500);
        }
    };

    return true;
}

// ===== SESSION MANAGEMENT =====

startBtn.addEventListener('click', async function() {
    if (isSessionActive) return;
    startBtn.disabled = true;
    updateStatus('Starting voice session...', 'processing');
    
    try {
        const response = await fetch('/start-voice-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message);
        }
        
        sessionId = data.session_id;
        isSessionActive = true;
        
        addToTranscript('Voice session initialized');
        addToTranscript(`Session ID: ${sessionId}`);
        
        const welcomeMessage = "Hello! Welcome to OTC Voice Trading. I can help you get cryptocurrency prices, place orders, and manage trades. Which exchange would you like to trade on today? You can choose from Binance, Bybit, OKX, or Deribit.";
        addToTranscript(`🤖 Bot: ${welcomeMessage}`);
        speakText(welcomeMessage);
        
        if (!recognition) initializeSpeechRecognition();
        recognition.start();
        stopBtn.disabled = false;
        updateStatus('Listening...', 'listening');
        
    } catch (error) {
        addToTranscript(`Error: ${error.message}`);
        updateStatus('Ready to start voice session', 'ready');
        startBtn.disabled = false;
    }
});

stopBtn.addEventListener('click', function() {
    addToTranscript('Stopping voice session...');
    isSessionActive = false;
    isListening = false;
    
    if (recognition) recognition.stop();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    
    // Reset context
    currentExchange = null;
    currentSymbol = null;
    sessionId = null;
    
    updateStatus('Voice session stopped', 'ready');
    stopBtn.disabled = true;
    startBtn.disabled = false;
    addToTranscript('Voice session ended');
});

clearBtn.addEventListener('click', function() {
    transcriptDiv.innerHTML = 'Conversation transcript will appear here...';
    addToTranscript('Transcript cleared');
});

// ===== INITIALIZATION =====

document.addEventListener('DOMContentLoaded', function() {
    addToTranscript('— Web Voice OTC Trading Bot —');
    addToTranscript('Press "Start Voice Session" to begin speaking');
    addToTranscript('Keyboard shortcut: Ctrl + Space to start/stop');
    addToTranscript('Supported Exchanges: Binance, Bybit, OKX, Deribit');
    updateStatus('Ready to start voice session', 'ready');
    
    // Health check
    fetch('/health').then(res => res.json()).then(data => {
        if (data.status === 'healthy') {
            addToTranscript('Server connection healthy');
            addToTranscript(`Mode: ${data.mode}`);
            if (data.exchanges_supported) {
                addToTranscript(`Exchanges: ${data.exchanges_supported.join(', ')}`);
            }
        }
    }).catch(() => {
        addToTranscript('Server connection failed');
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(event) {
        if (event.ctrlKey && event.code === 'Space') {
            event.preventDefault();
            if (isSessionActive) {
                stopBtn.click();
            } else {
                startBtn.click();
            }
        }
    });
});

// ===== UTILITY FUNCTIONS =====

// Show current trading context
function showTradingContext() {
    if (currentExchange || currentSymbol) {
        let context = 'Current Context: ';
        if (currentExchange) context += `Exchange: ${currentExchange} `;
        if (currentSymbol) context += `Symbol: ${currentSymbol}`;
        addToTranscript(context);
    }
}

// Market data refresh function
async function refreshMarketData() {
    if (currentExchange && currentSymbol) {
        await fetchSymbolPrice(currentExchange, currentSymbol);
    }
}

// Export functions for debugging
window.OTCBot = {
    fetchExchangeSymbols,
    fetchSymbolPrice,
    validateSymbol,
    showTradingContext,
    refreshMarketData,
    selectExchange,
    selectSymbol
};
