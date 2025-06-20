import os
import requests
import json
import whisper
import tempfile
from flask import Flask, jsonify, render_template, send_from_directory, request
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
BLAND_API_KEY = os.getenv("BLAND_API_KEY")
BLAND_AGENT_ID = os.getenv("BLAND_AGENT_ID")

# Load Whisper model once at startup
print("Loading Whisper model...")
whisper_model = whisper.load_model("base")
print("Whisper model loaded successfully!")

app = Flask(__name__, static_folder="static", template_folder="templates", static_url_path='/static')
CORS(app)

# ===== BLAND AI INTEGRATION =====

def create_bland_chat(pathway_id, api_key):
    """Create a new Bland AI chat session"""
    url = "https://us.api.bland.ai/v1/pathway/chat/create"
    headers = {"authorization": api_key, "Content-Type": "application/json"}
    data = {"pathway_id": pathway_id}
    
    try:
        print(f"Creating chat for pathway: {pathway_id}")
        response = requests.post(url, headers=headers, json=data, timeout=30)
        response.raise_for_status()
        response_data = response.json()
        
        if response_data.get("errors"):
            error_msg = response_data["errors"][0].get("message", "Unknown error")
            raise Exception(f"Bland AI error: {error_msg}")
        
        # Handle both possible response formats
        if response_data.get("data") and "chat_id" in response_data["data"]:
            chat_id = response_data["data"]["chat_id"]
        elif "chat_id" in response_data:
            chat_id = response_data["chat_id"]
        else:
            raise Exception(f"No chat_id found in response: {response_data}")
        
        print(f"Successfully created chat: {chat_id}")
        return chat_id
        
    except Exception as e:
        print(f"Chat creation error: {str(e)}")
        raise

def send_message_to_bland(chat_id, message, api_key):
    """Send message to Bland AI pathway with robust response parsing"""
    url = f"https://us.api.bland.ai/v1/pathway/chat/{chat_id}"
    headers = {"authorization": api_key, "Content-Type": "application/json"}
    data = {"message": message}
    
    try:
        print(f"Sending message to chat {chat_id}: '{message}'")
        response = requests.post(url, headers=headers, json=data, timeout=30)
        response.raise_for_status()
        response_data = response.json()
        
        if response_data.get("errors"):
            error_msg = response_data["errors"][0].get("message", "Unknown error")
            raise Exception(f"Bland AI error: {error_msg}")
        
        # Extract assistant response from multiple possible locations
        assistant_response = ""
        
        # Primary: assistant_responses array
        if (response_data.get("data") and 
            "assistant_responses" in response_data["data"] and 
            response_data["data"]["assistant_responses"]):
            assistant_responses = response_data["data"]["assistant_responses"]
            if len(assistant_responses) > 0:
                assistant_response = assistant_responses[0]
                print(f"Found assistant response: '{assistant_response}'")
        
        # Fallback: other possible formats
        if not assistant_response:
            if "Assistant Response" in response_data:
                assistant_response = response_data["Assistant Response"]
            elif response_data.get("data") and "Assistant Response" in response_data["data"]:
                assistant_response = response_data["data"]["Assistant Response"]
        
        if not assistant_response or not assistant_response.strip():
            return "I'm having trouble generating a response. Please try again."
        
        print(f"Final response: '{assistant_response}'")
        return assistant_response
        
    except Exception as e:
        print(f"Message send error: {str(e)}")
        raise

# ===== WHISPER INTEGRATION =====

def transcribe_with_whisper(audio_file):
    """Transcribe audio using OpenAI Whisper with proper temp file handling"""
    try:
        # Save the uploaded file to a temp file, close it, then transcribe
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            audio_file.save(tmp_file.name)
            temp_path = tmp_file.name
        
        print(f"Transcribing audio file: {temp_path}")
        result = whisper_model.transcribe(temp_path)
        transcript = result['text'].strip()
        print(f"Transcription result: '{transcript}'")
        
        return transcript
        
    except Exception as e:
        print(f"Whisper transcription error: {str(e)}")
        raise
    finally:
        # Clean up temp file
        try:
            if 'temp_path' in locals():
                os.remove(temp_path)
        except Exception as e:
            print(f"Warning: could not delete temp file {temp_path}: {e}")

# ===== EXCHANGE API INTEGRATION =====

def get_exchange_symbols(exchange):
    """Get available trading symbols from a chosen exchange"""
    try:
        if exchange == 'binance':
            url = "https://api.binance.com/api/v3/exchangeInfo"
            response = requests.get(url, timeout=10)
            data = response.json()
            symbols = [s['symbol'] for s in data['symbols'] if s['status'] == 'TRADING'][:100]
            
        elif exchange == 'bybit':
            url = "https://api.bybit.com/v5/market/instruments-info"
            response = requests.get(url, params={"category": "spot"}, timeout=10)
            data = response.json()
            symbols = [item['symbol'] for item in data['result']['list']][:100]
            
        elif exchange == 'okx':
            url = "https://www.okx.com/api/v5/public/instruments"
            response = requests.get(url, params={"instType": "SPOT"}, timeout=10)
            data = response.json()
            symbols = [item['instId'] for item in data['data']][:100]
            
        elif exchange == 'deribit':
            url = "https://www.deribit.com/api/v2/public/get_instruments"
            response = requests.get(url, params={"currency": "BTC", "kind": "future"}, timeout=10)
            data = response.json()
            symbols = [item['instrument_name'] for item in data['result']][:50]
            
        else:
            return []
            
        return symbols
        
    except Exception as e:
        print(f"Exchange symbols error: {str(e)}")
        return []

def get_symbol_price(exchange, symbol):
    """Get current price for a symbol on a given exchange"""
    try:
        if exchange == 'binance':
            url = "https://api.binance.com/api/v3/ticker/price"
            response = requests.get(url, params={"symbol": symbol}, timeout=10)
            data = response.json()
            return float(data['price'])
            
        elif exchange == 'bybit':
            url = "https://api.bybit.com/v5/market/tickers"
            response = requests.get(url, params={"category": "spot", "symbol": symbol}, timeout=10)
            data = response.json()
            return float(data['result']['list'][0]['lastPrice'])
            
        elif exchange == 'okx':
            url = "https://www.okx.com/api/v5/market/ticker"
            response = requests.get(url, params={"instId": symbol}, timeout=10)
            data = response.json()
            return float(data['data'][0]['last'])
            
        elif exchange == 'deribit':
            url = "https://www.deribit.com/api/v2/public/ticker"
            response = requests.get(url, params={"instrument_name": symbol}, timeout=10)
            data = response.json()
            return float(data['result']['last_price'])
            
        else:
            return 0.0
            
    except Exception as e:
        print(f"Price fetch error: {str(e)}")
        return 0.0

def get_crypto_price_fallback(symbol):
    """Fallback price function using CoinGecko"""
    try:
        coingecko_map = {
            'BTC': 'bitcoin',
            'ETH': 'ethereum', 
            'USDT': 'tether',
            'SOL': 'solana',
            'MATIC': 'polygon'
        }
        
        cg_id = coingecko_map.get(symbol.upper(), 'bitcoin')
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={cg_id}&vs_currencies=usd"
        response = requests.get(url, timeout=5)
        data = response.json()
        return data[cg_id]['usd']
        
    except:
        return 50000  # Fallback price

# ===== FLASK ROUTES =====

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    response = send_from_directory(app.static_folder, filename)
    if filename.endswith('.js'):
        response.headers['Content-Type'] = 'application/javascript'
    elif filename.endswith('.html'):
        response.headers['Content-Type'] = 'text/html'
    elif filename.endswith('.css'):
        response.headers['Content-Type'] = 'text/css'
    return response

@app.route('/start-voice-session', methods=['POST'])
def start_voice_session():
    """Initialize a Bland AI chat session"""
    try:
        if not BLAND_API_KEY or not BLAND_AGENT_ID:
            raise Exception("BLAND_API_KEY or BLAND_AGENT_ID not configured")
        
        chat_id = create_bland_chat(BLAND_AGENT_ID, BLAND_API_KEY)
        
        return jsonify({
            "session_id": chat_id,
            "status": "initialized",
            "success": True,
            "message": "Voice session started. You can now speak into your microphone."
        })
        
    except Exception as e:
        print(f"Session initialization error: {str(e)}")
        return jsonify({
            "error": "Session initialization error",
            "message": str(e),
            "success": False
        }), 500

@app.route('/whisper-transcribe', methods=['POST'])
def whisper_transcribe():
    """Transcribe audio using OpenAI Whisper"""
    try:
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided", "success": False}), 400
        
        audio_file = request.files['audio']
        transcript = transcribe_with_whisper(audio_file)
        
        return jsonify({
            "transcript": transcript,
            "success": True
        })
        
    except Exception as e:
        print(f"Transcription error: {str(e)}")
        return jsonify({
            "error": "Transcription error",
            "message": str(e),
            "success": False
        }), 500

@app.route('/process-audio', methods=['POST'])
def process_audio():
    """Process user audio input through Bland AI pathway"""
    try:
        chat_id = request.form.get('session_id')
        user_text = request.form.get('transcription', '')
        
        if not chat_id:
            return jsonify({"error": "Missing session_id", "success": False}), 400
        if not user_text:
            return jsonify({"error": "Missing transcription", "success": False}), 400
        
        # Send to Bland AI pathway
        bland_reply = send_message_to_bland(chat_id, user_text, BLAND_API_KEY)
        
        return jsonify({
            "transcription": user_text,
            "response_text": bland_reply,
            "response_audio": "",
            "actions": [],
            "success": True
        })
        
    except Exception as e:
        print(f"Audio processing error: {str(e)}")
        return jsonify({
            "error": "Audio processing error",
            "message": str(e),
            "success": False
        }), 500

@app.route('/exchanges', methods=['GET'])
def get_exchanges():
    """Get available trading symbols from a chosen exchange"""
    exchange = request.args.get('exchange', '').lower()
    
    if not exchange:
        return jsonify({
            "error": "Exchange parameter required",
            "supported": ["binance", "bybit", "okx", "deribit"]
        }), 400
    
    try:
        symbols = get_exchange_symbols(exchange)
        
        if not symbols:
            return jsonify({
                "error": "Failed to fetch symbols or unsupported exchange",
                "supported": ["binance", "bybit", "okx", "deribit"]
            }), 400
        
        return jsonify({
            "exchange": exchange,
            "symbols": symbols,
            "count": len(symbols),
            "success": True
        })
        
    except Exception as e:
        return jsonify({
            "error": f"Exchange API error: {str(e)}",
            "success": False
        }), 500

@app.route('/price', methods=['GET'])
def get_price():
    """Get current price for a symbol on a given exchange"""
    exchange = request.args.get('exchange', '').lower()
    symbol = request.args.get('symbol', '').upper()
    
    if not exchange or not symbol:
        return jsonify({
            "error": "Both exchange and symbol parameters required",
            "success": False
        }), 400
    
    try:
        price = get_symbol_price(exchange, symbol)
        
        if price == 0.0:
            # Try fallback price for common symbols
            price = get_crypto_price_fallback(symbol.replace('USDT', '').replace('USD', ''))
        
        return jsonify({
            "exchange": exchange,
            "symbol": symbol,
            "price": price,
            "formatted_price": f"${price:,.2f}",
            "success": True
        })
        
    except Exception as e:
        return jsonify({
            "error": f"Price fetch error: {str(e)}",
            "success": False
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint with comprehensive status"""
    return jsonify({
        "status": "healthy",
        "pathway_id": BLAND_AGENT_ID,
        "api_configured": bool(BLAND_API_KEY),
        "whisper_loaded": whisper_model is not None,
        "exchanges_supported": ["binance", "bybit", "okx", "deribit"],
        "mode": "web_voice"
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def server_error(error):
    return jsonify({"error": "Internal server error"}), 500

# ===== MAIN =====

if __name__ == '__main__':
    # Create required directories
    os.makedirs('templates', exist_ok=True)
    os.makedirs('static', exist_ok=True)
    
    print(f"Starting OTC Voice Trading Bot (Web Voice Mode)...")
    print(f"API Key: {BLAND_API_KEY[:20] if BLAND_API_KEY else 'NOT SET'}...")
    print(f"Pathway ID: {BLAND_AGENT_ID}")
    print(f"Whisper Model: Loaded (base)")
    print(f"Exchanges: Binance, Bybit, OKX, Deribit")
    print(f"Server: http://127.0.0.1:5000")
    
    app.run(debug=True, host='127.0.0.1', port=5000)
