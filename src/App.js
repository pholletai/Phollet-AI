import React, { useState } from "react";
import "./App.css";

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const handleSend = async () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: "user", content: input }]);
    const res = await fetch("http://localhost:5000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input })
    });
    const data = await res.json();
    const reply = data.reply || data.response || 'សុំទោស មិនអាចឆ្លើយបានទេ។';
    setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    setInput("");
  };

  return (
    <div className="ai-dashboard">
      <aside className="sidebar">
        <h2 className="logo">Phollet AI</h2>
        <ul>
          <li>🤖 AI Agents</li>
          <li>💬 Chat History</li>
          <li>⚙️ Settings</li>
          <li>🚀 Upgrade Plan</li>
        </ul>
      </aside>

      <main className="chat-section">
        <header className="agent-header">
          <div className="agent-avatar"></div>
          <div>
            <h3>Phollet Sonnet Agent</h3>
            <span className="status">🟢 Online</span>
          </div>
        </header>

        <div className="chat-box">
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              <span>{m.content}</span>
            </div>
          ))}
        </div>

        <div className="input-bar">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
          />
          <button onClick={handleSend}>Send</button>
        </div>
      </main>
    </div>
  );
}

export default App;