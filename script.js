:root {
  --bg: #fff;
  --ink: #222;
  --muted: #666;
  --accent: #1867c0;
  --border: #e6e6e6;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); }
.layout { display: grid; grid-template-columns: 300px 1fr; min-height: 100vh; }
.filters { padding: 1rem; border-right: 1px solid var(--border); }
.filters h2 { margin-top: 0; }
.filters label { display: block; margin: .75rem 0; }
.filters select { width: 100%; min-height: 6rem; }
.filters input[type=text] { width: 100%; padding: .5rem; }
.filters button { width: 100%; padding: .6rem .8rem; margin: .4rem 0; background: var(--accent); color: #fff; border: 0; border-radius: .25rem; cursor: pointer; }
.filters button#btn-clear { background: #999; }
.content { padding: 1rem 1.5rem; }
#cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 1rem; align-items: start; }
.card { border: 1px solid var(--border); border-radius: .5rem; padding: 1rem; background: #fff; display: flex; flex-direction: column; gap: .5rem; }
.card h3 { margin: 0; font-size: 1.05rem; }
.meta { font-size: .9rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: .6rem; }
.meta span { background: #f7f7f7; padding: .2rem .4rem; border-radius: .25rem; }
.actions { margin-top: .5rem; display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
.link { color: var(--accent); text-decoration: none; }
.link:hover { text-decoration: underline; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .filters { border-right: none; border-bottom: 1px solid var(--border); }
}

.common-name {
  font-size: 0.95rem;
  color: var(--muted);
  margin-top: -0.3rem;
  margin-bottom: 0.5rem;
  font-style: italic;
}

.image-container {
  position: relative;
}

.species-image {
  width: 100%;
  height: 200px;
  border-radius: 8px;
  object-fit: cover;
}

.image-credit {
  font-size: 0.7rem;
  color: var(--muted);
  text-align: center;
  margin-top: 0.25rem;
  font-style: italic;
}
