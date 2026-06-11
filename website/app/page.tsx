const files = [
  ["folder open", "src"],
  ["indent folder open", "scratchnn"],
  ["indent-2", "__init__.py"],
  ["indent-2", "data.py"],
  ["indent-2", "layers.py"],
  ["indent-2 active", "math_ops.py"],
  ["indent-2", "model.py"],
  ["folder", "tests"],
  ["", "pyproject.toml"],
  ["", "README.md"]
];

const features = [
  ["layers", "Executable learning tapes", "Tapes set up your workspace, guide each step, and run the code alongside you."],
  ["signal", "Ghost guidance, not ghost coding", "Hints arrive when you are stuck. The answer stays yours."],
  ["recall", "Recall that sticks", "Active checks train memory and reveal what needs a deeper explanation."],
  ["verify", "Verify what you built", "Automated tests and agent review confirm the code works and why."]
];

const cards = [
  ["global", "Framework agnostic", "Works with any stack. Bring your favorite tools and libraries."],
  ["loop", "Recall-driven flow", "Short loops and small wins strengthen long-term memory."],
  ["card", "Concept cards", "Just-in-time explanations connect the dots when you need them."],
  ["check", "Verification built in", "Tests, linters, and checks run as you build."],
  ["cup", "Project progression", "From tiny wins to real systems. Ship and show what you learned."]
];

export default function Page() {
  return (
    <div className="site-shell">
      <header className="nav">
        <a className="brand" href="#top" aria-label="Construct home">
          <span className="brand-mark" aria-hidden="true" />
          <span>Construct</span>
        </a>
        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#tapes">Tapes</a>
          <a href="#docs">Docs</a>
          <a href="#examples">Examples</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <a className="search" href="#docs" aria-label="Search docs">
          <span aria-hidden="true">⌕</span>
          <span>Search docs...</span>
          <kbd>⌘ K</kbd>
        </a>
        <a className="nav-cta" href="#waitlist">
          Join waitlist <span aria-hidden="true">&rarr;</span>
        </a>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="particle particle-one" aria-hidden="true" />
          <div className="hero-copy reveal">
            <p className="eyebrow">
              <span />
              Project-based learning IDE
            </p>
            <h1 id="hero-title">
              Build real software, <strong>learn with intent.</strong>
            </h1>
            <p className="hero-text">
              Construct turns projects into executable learning tapes that create your workspace, guide implementation, test recall, and verify your code.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#waitlist">
                Get started <span aria-hidden="true">&rarr;</span>
              </a>
              <a className="button secondary" href="#demo">
                <span className="play" aria-hidden="true" /> View demo
              </a>
            </div>
            <div className="social-proof" aria-label="Community signal">
              <div className="avatars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <p>Loved by builders, students, and engineers worldwide.</p>
            </div>
          </div>

          <IdePreview />
        </section>

        <section className="panel wide reveal" id="product">
          <div className="particle particle-two" aria-hidden="true" />
          <h2>
            Construct is for developers, students, and engineers who want to <strong>understand systems</strong>, not just finish tutorials.
          </h2>
          <div className="feature-grid">
            {features.map(([icon, title, body]) => (
              <article key={title}>
                <span>{icon}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="split panel reveal" id="tapes">
          <div className="tape-window">
            <div className="mini-tabs">
              <span>Tape (MDX)</span>
              <span>Preview</span>
            </div>
            <pre><code>{`---
title: Create a shorten endpoint
step: 2
---

## Goal
Create a POST /shorten endpoint that accepts a URL.

## Tasks
- Parse and validate request body
- Generate a 7-character code
- Store and return the code

\`\`\`ts
app.post('/shorten', async (req, res) => {
  // Write your code here
});
\`\`\``}</code></pre>
          </div>
          <div className="workflow-copy">
            <h2>
              Anybody can start. Engineers <strong>go deep.</strong>
            </h2>
            <p>
              Our tape format is human-first and machine-executable. Write in Markdown, add tasks, hints, code blocks, checks, and concepts. Construct handles the rest.
            </p>
            <div className="steps">
              <span><b>Write</b>Author or run tapes in MDX.</span>
              <i />
              <span><b>Run</b>Construct sets up, tests, and verifies.</span>
              <i />
              <span><b>Learn</b>Build with feedback. Improve with intent.</span>
            </div>
          </div>
        </section>

        <section className="card-row reveal" id="docs">
          {cards.map(([icon, title, body]) => (
            <article key={title}>
              <span>{icon}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </section>

        <section className="cta reveal" id="waitlist">
          <div className="particle particle-three" aria-hidden="true" />
          <div>
            <h2>
              Stop watching tutorials. <strong>Start constructing.</strong>
            </h2>
            <p>Learn by building real projects with executable tapes.</p>
          </div>
          <a className="button primary" href="mailto:hello@tryconstruct.cc?subject=Construct%20waitlist">
            Join the waitlist <span aria-hidden="true">&rarr;</span>
          </a>
        </section>
      </main>
    </div>
  );
}

function IdePreview() {
  return (
    <div className="ide-card reveal" id="demo">
      <div className="ide-topbar">
        <div className="window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>Python Neural Network From Scratch</strong>
        <span className="step-pill">11/74</span>
      </div>
      <div className="ide-body">
        <aside className="ide-sidebar">
          <p>Explorer</p>
          <div className="file-search">Search files...</div>
          <ul>
            {files.map(([className, name]) => (
              <li className={className} key={name}>{name}</li>
            ))}
          </ul>
          <div className="knowledge">
            <p>Knowledge <span>0/3</span></p>
            <span>Array shapes are contracts</span>
            <span>XOR requires a bend in the line</span>
            <span>Sigmoid turns scores into probabilities</span>
          </div>
        </aside>
        <section className="editor" aria-label="Code editor preview">
          <div className="tab">math_ops.py</div>
          <pre><code>{`1  from __future__ import annotations
2
3  import numpy as np
4
5
6  def sigmoid(values: np.ndarray) -> np.ndarray:
7      """Map raw scores to probability-like values."""
8      clipped = np.clip(values, -500.0, 500.0)
9      return 1.0 / (1.0 + np.exp(-clipped))
10
11
12 def sigmoid_grad_from_output(output: np.ndarray) -> np.ndarray:
13     """Return d(sigmoid)/dx using an already-computed output."""
14     return output * (1.0 - output)`}</code></pre>
          <div className="floating-progress">
            <span>Code step</span>
            <strong>8 / 14 lines</strong>
            <div><i /></div>
            <b>44%</b>
          </div>
        </section>
        <aside className="guide">
          <div className="guide-tabs"><span className="selected">Guide</span><span>Steps</span><span>Git</span></div>
          <p className="guide-label">Code step <b>11/74</b></p>
          <h2>Implement the probability gate</h2>
          <blockquote>This edit creates the first reusable mathematical primitive for the network.</blockquote>
          <p>Complete the highlighted implementation in <code>src/scratchnn/math_ops.py</code>.</p>
          <div className="progress-box">
            <span>Code step progress</span>
            <strong>8 / 14 lines · 44%</strong>
            <div><i /></div>
          </div>
          <small>4 line reveals</small>
        </aside>
      </div>
      <div className="terminal">
        <span>Terminal</span>
        <p>~/Downloads/python-neural-network-from-scratch</p>
        <strong>Node system 09:21:00</strong>
      </div>
    </div>
  );
}
