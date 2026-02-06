/**
 * Genesis — Metrics API Server
 * 
 * Serves real-time metrics dashboard at http://localhost:3000
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const metricsCollector = require('./collector');

class MetricsServer {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
  }

  start() {
    this.server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Route handling
      if (req.url === '/' || req.url === '/index.html') {
        this.serveHTML(res);
      } else if (req.url === '/api/metrics') {
        this.serveMetrics(res);
      } else if (req.url === '/api/metrics/stream') {
        this.serveMetricsStream(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      console.log(`\n📊 [Metrics] Dashboard available at http://localhost:${this.port}`);
      console.log(`   API endpoint: http://localhost:${this.port}/api/metrics\n`);
    });

    return this.server;
  }

  serveHTML(res) {
    const htmlPath = path.join(__dirname, '../../public/dashboard.html');
    
    fs.readFile(htmlPath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading dashboard');
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
  }

  serveMetrics(res) {
    const metrics = metricsCollector.getAll();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
  }

  serveMetricsStream(req, res) {
    // Server-Sent Events for real-time updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial data
    const sendMetrics = () => {
      const metrics = metricsCollector.getAll();
      res.write(`data: ${JSON.stringify(metrics)}\n\n`);
    };

    sendMetrics();

    // Update every 2 seconds
    const interval = setInterval(sendMetrics, 2000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(interval);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('📊 [Metrics] Server stopped');
    }
  }
}

module.exports = MetricsServer;
