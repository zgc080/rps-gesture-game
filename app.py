from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    # Running on 0.0.0.0 to allow access if needed, strict local development usually fine too.
    # Debug mode enabled for easier development.
    app.run(debug=True, port=5000)
