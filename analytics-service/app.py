import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from model import EngagementPredictor
app = Flask(__name__)
CORS(app)
# Initialize the global predictor instance
predictor = EngagementPredictor()
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "model_trained": predictor.is_trained
    }), 200
@app.route('/train', methods=['POST'])
def train():
    try:
        data = request.get_json()
        if not data or 'posts' not in data:
            return jsonify({"error": "Missing 'posts' array in request body"}), 400
            
        posts = data['posts']
        success = predictor.train(posts)
        
        if success:
            return jsonify({
                "message": "Model trained successfully",
                "trained_on_posts": len(posts)
            }), 200
        else:
            return jsonify({
                "message": "Model training skipped or failed (insufficient data)",
                "trained_on_posts": len(posts),
                "model_trained": predictor.is_trained
            }), 200
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500
@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json()
        if not data or 'variations' not in data:
            return jsonify({"error": "Missing 'variations' array in request body"}), 400
            
        variations = data['variations']
        if not variations:
            return jsonify({"error": "Variations array is empty"}), 400
            
        # Predict scores
        predicted_scores = predictor.predict_variations(variations)
        
        # Calculate comparison details
        best_index = predicted_scores.index(max(predicted_scores)) if len(predicted_scores) > 1 else 0
        best_score = predicted_scores[best_index]
        
        # Compute boost compared to the average of other variations
        if len(predicted_scores) > 1:
            other_scores = [predicted_scores[i] for i in range(len(predicted_scores)) if i != best_index]
            avg_other = sum(other_scores) / len(other_scores)
            if avg_other > 0:
                boost_percent = int(round(((best_score - avg_other) / avg_other) * 100))
            else:
                boost_percent = 0
        else:
            boost_percent = 0
            
        # Structure the response
        results = []
        for i, var in enumerate(variations):
            results.append({
                "moodTags": var.get("moodTags", []),
                "poeticCaption": var.get("poeticCaption", ""),
                "predictedScore": round(predicted_scores[i], 2),
                "isBest": i == best_index
            })
            
        return jsonify({
            "predictions": results,
            "bestIndex": best_index,
            "boostPercent": boost_percent,
            "modelTrained": predictor.is_trained
        }), 200
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)