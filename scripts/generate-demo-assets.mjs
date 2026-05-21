import fs from 'node:fs/promises';
import path from 'node:path';

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function svg(template,title,subtitle,bullets,w,h){
const base=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0B1220"/><stop offset="100%" stop-color="#1F2A44"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>`;
if(template==='pipeline_diagram') return `${base}<text x="80" y="90" fill="#E6EEF8" font-size="54" font-family="Arial" font-weight="700">${esc(title)}</text><text x="80" y="138" fill="#B8C7DD" font-size="26" font-family="Arial">${esc(subtitle)}</text><rect x="80" y="240" rx="18" ry="18" width="290" height="120" fill="#243654" stroke="#4B6A9B"/><rect x="470" y="240" rx="18" ry="18" width="290" height="120" fill="#243654" stroke="#4B6A9B"/><rect x="860" y="240" rx="18" ry="18" width="290" height="120" fill="#243654" stroke="#4B6A9B"/><rect x="1250" y="240" rx="18" ry="18" width="270" height="120" fill="#243654" stroke="#4B6A9B"/><text x="115" y="310" fill="#E6EEF8" font-size="30" font-family="Arial">Claude Desktop</text><text x="507" y="310" fill="#E6EEF8" font-size="30" font-family="Arial">MCP Runner</text><text x="915" y="310" fill="#E6EEF8" font-size="30" font-family="Arial">Local ComfyUI</text><text x="1290" y="310" fill="#E6EEF8" font-size="30" font-family="Arial">Outputs</text></svg>`;
const b=(bullets||[]).map((x,i)=>`<text x="100" y="${330+i*58}" fill="#C7D7F0" font-size="30" font-family="Arial">• ${esc(x)}</text>`).join('');
return `${base}<rect x="70" y="70" width="${w-140}" height="${h-140}" rx="24" ry="24" fill="rgba(10,16,28,0.42)" stroke="#3D5480"/><text x="100" y="170" fill="#F2F7FF" font-size="64" font-family="Arial" font-weight="700">${esc(title)}</text><text x="100" y="235" fill="#AFC3E6" font-size="32" font-family="Arial">${esc(subtitle)}</text>${b}</svg>`;
}
async function main(){
 const outDir=path.resolve('demo-assets'); await fs.mkdir(outDir,{recursive:true});
 const specs=[['github_hero_banner','ComfyUI MCP Runner','Local-first MCP media runner for Claude + ComfyUI workflows',['Run local ComfyUI workflows via MCP','No hosted server','Deterministic SVG launch assets'],'hero-banner',1600,900],['pipeline_diagram','Local Pipeline','Claude Desktop → MCP Runner → Local ComfyUI → Outputs / Gallery',[],'pipeline-diagram',1600,900],['social_launch_card','Launch: ComfyUI MCP Runner','Run local ComfyUI workflows from Claude. Local-first. No hosted server.',['MCP-compatible','No API key required for SVG backend'],'social-launch-card',1200,630]];
 for(const [t,ti,sub,b,fn,w,h] of specs){const p=path.join(outDir,`${fn}.svg`); await fs.writeFile(p,svg(t,ti,sub,b,w,h)); const st=await fs.stat(p); if(st.size<=0) throw new Error('empty'); console.log('generated',p);}
}
main();
