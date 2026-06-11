import re
class EngagementPredictor:
    def __init__(self):
        self.is_trained = False
        # Feature weights
        self.w_length = 0.0
        self.w_hashtag = 0.0
        self.w_emoji = 0.0
        self.w_tags = {}  # weights for each tag
        self.intercept = 50.0  # baseline engagement
        self.learning_rate = 0.01
        self.epochs = 150
    def _normalize_length(self, caption):
        # Sweet spot for length is around 40-100 characters.
        # Let's compute deviation from 70 characters.
        length = len(caption) if caption else 0
        deviation = abs(70 - length)
        # Normalize: 0 if perfect (70 chars), negative values as length deviates
        return -float(deviation) / 10.0
    def _count_emojis(self, text):
        if not text:
            return 0
        # Count non-alphanumeric, non-space, non-punctuation
        cleaned = re.sub(r'[\w\s\d.,!?;:\'\"()\-#@]', '', text)
        return len(cleaned)
    def _count_hashtags(self, text):
        return text.count('#') if text else 0
    def train(self, historical_posts):
        """
        Trains the Linear Regression model using Stochastic Gradient Descent.
        historical_posts: list of dicts with keys: poeticCaption, moodTags, likes, shares
        """
        if len(historical_posts) < 5:
            print("Not enough historical data to train model. Minimum 5 posts required.")
            return False
        # Reset weights
        self.w_length = 0.1
        self.w_hashtag = 0.1
        self.w_emoji = 0.1
        self.w_tags = {}
        self.intercept = 40.0
        # Build vocabulary of tags and initialize weights
        for post in historical_posts:
            tags = post.get('moodTags', [])
            for t in tags:
                tag_name = t.lower().strip()
                if tag_name not in self.w_tags:
                    self.w_tags[tag_name] = 0.0
        # Prepare training data
        dataset = []
        for post in historical_posts:
            caption = post.get('poeticCaption', '')
            tags = [t.lower().strip() for t in post.get('moodTags', [])]
            likes = post.get('likes', 0)
            shares = post.get('shares', 0)
            
            # Target variable: Engagement Score = likes + 2 * shares
            target = float(likes + 2 * shares)
            
            x_len = self._normalize_length(caption)
            x_hash = float(self._count_hashtags(caption))
            x_emoji = float(self._count_emojis(caption))
            
            dataset.append({
                'x_len': x_len,
                'x_hash': x_hash,
                'x_emoji': x_emoji,
                'tags': tags,
                'target': target
            })
        # Stochastic Gradient Descent Loop
        for epoch in range(self.epochs):
            # Dynamic learning rate decay
            lr = self.learning_rate / (1.0 + 0.01 * epoch)
            
            for sample in dataset:
                # 1. Compute prediction
                tag_sum = sum(self.w_tags.get(t, 0.0) for t in sample['tags'])
                pred = self.intercept + (self.w_length * sample['x_len']) + \
                       (self.w_hashtag * sample['x_hash']) + (self.w_emoji * sample['x_emoji']) + tag_sum
                
                # 2. Compute error
                error = pred - sample['target']
                
                # 3. Update weights
                self.intercept -= lr * error
                self.w_length -= lr * error * sample['x_len']
                self.w_hashtag -= lr * error * sample['x_hash']
                self.w_emoji -= lr * error * sample['x_emoji']
                
                for t in sample['tags']:
                    self.w_tags[t] -= lr * error
        self.is_trained = True
        print(f"Pure Python Linear Regression successfully trained on {len(historical_posts)} posts.")
        print(f"Intercept: {self.intercept:.2f}, w_length: {self.w_length:.2f}, w_hashtag: {self.w_hashtag:.2f}, w_emoji: {self.w_emoji:.2f}")
        return True
    def predict_variations(self, variations):
        """
        Predicts engagement scores for a list of variation dicts.
        Each variation dict should have: poeticCaption, moodTags.
        Returns a list of predicted scores.
        """
        scores = []
        for var in variations:
            caption = var.get('poeticCaption', '')
            tags = [t.lower().strip() for t in var.get('moodTags', [])]
            
            x_len = self._normalize_length(caption)
            x_hash = float(self._count_hashtags(caption))
            x_emoji = float(self._count_emojis(caption))
            
            tag_sum = sum(self.w_tags.get(t, 0.0) for t in tags if t in self.w_tags)
            
            # Predict using learned weights
            pred = self.intercept + (self.w_length * x_len) + \
                   (self.w_hashtag * x_hash) + (self.w_emoji * x_emoji) + tag_sum
                   
            # Ensure predicted score is at least a baseline score
            scores.append(max(float(pred), 5.0))
            
        return scores
