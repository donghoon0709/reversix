export const BOARD_SIZE = 10;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
export const WIN_LENGTH = 6;
export const BLACK = 'BLACK';
export const WHITE = 'WHITE';
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const AXES = [[0,1],[1,0],[1,1],[1,-1]];
const opponent = p => p === BLACK ? WHITE : BLACK;
const inside = (r,c) => r>=0&&r<BOARD_SIZE&&c>=0&&c<BOARD_SIZE;
const idx = (r,c) => r*BOARD_SIZE+c;

export function createInitialGame() {
  const board = Array(BOARD_CELLS).fill(null);
  const r0 = Math.floor((BOARD_SIZE - 1) / 2);
  board[idx(r0,r0)] = BLACK; board[idx(r0,r0+1)] = WHITE;
  board[idx(r0+1,r0)] = WHITE; board[idx(r0+1,r0+1)] = BLACK;
  const turnStart = { board: board.slice(), activePlayer: BLACK, checkedPlayer: null, opening: true };
  return { board, activePlayer: BLACK, checkedPlayer: null, turnStart, provisional: {placements:[], effects:[], board:board.slice()}, recentEffects:[], announcement:'', terminal:null };
}
export function requiredPlacements(snapshot) {
  const empties = snapshot.board.filter(x=>x==null).length;
  return snapshot.opening || snapshot.turnStart?.opening ? 1 : (empties===1 ? 1 : 2);
}
function placementEffect(board, player, cell) {
  if (!Number.isInteger(cell)||cell<0||cell>=BOARD_CELLS) return {ok:false,reason:'INVALID_CELL'};
  if (board[cell]!=null) return {ok:false,reason:'OCCUPIED'};
  const next=board.slice(); next[cell]=player; const opp=opponent(player); const flips=[];
  const r=Math.floor(cell/BOARD_SIZE), c=cell%BOARD_SIZE;
  for(const [dr,dc] of DIRS){ let rr=r+dr, cc=c+dc, run=[]; while(inside(rr,cc)&&next[idx(rr,cc)]===opp){run.push(idx(rr,cc)); rr+=dr; cc+=dc;} if(run.length&&inside(rr,cc)&&next[idx(rr,cc)]===player) flips.push(...run); }
  if (!flips.length) return {ok:false,reason:'NO_FLIPS'};
  for(const x of flips) next[x]=player;
  return {ok:true,board:next,effect:{cell,player,flips:[...new Set(flips)]}};
}
export function applyPlacement(board, player, cell) { return placementEffect(board,player,cell); }
export function getLegalPlacements(board, player) { const out=[]; for(let i=0;i<BOARD_CELLS;i++) if(placementEffect(board,player,i).ok) out.push(i); return out; }
/**
 * Placements available for the current sub-move of a turn. A turn is a unit: when two
 * stones are required, the first one only counts if a legal second stone still exists,
 * otherwise the player would be stranded with an unfinishable turn.
 */
export function getPlaceableCells(board, player, need, placed) {
  if (placed >= 1 || need === 1) return getLegalPlacements(board, player);
  const out = [];
  for (const first of getLegalPlacements(board, player)) {
    const a = placementEffect(board, player, first);
    if (a.ok && getLegalPlacements(a.board, player).length) out.push(first);
  }
  return out;
}
export function placeableFor(state) {
  return getPlaceableCells(state.provisional.board, state.activePlayer,
                           requiredPlacements(state.turnStart), state.provisional.placements.length);
}
export function hasLegalFullTurn(turnStart) { const need=requiredPlacements(turnStart); const first=getLegalPlacements(turnStart.board,turnStart.activePlayer); if(need===1) return first.length>0; for(const cell of first){ const a=placementEffect(turnStart.board,turnStart.activePlayer,cell); if(getLegalPlacements(a.board,turnStart.activePlayer).length) return true; } return false; }
export function findWinningLines(board, player) { const lines=[]; for(const [dr,dc] of AXES) for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++){ const pr=r-dr,pc=c-dc; if(inside(pr,pc)&&board[idx(pr,pc)]===player) continue; let line=[]; let rr=r,cc=c; while(inside(rr,cc)&&board[idx(rr,cc)]===player){line.push(idx(rr,cc));rr+=dr;cc+=dc;} if(line.length>=WIN_LENGTH) lines.push(line); } return lines; }
function resolve(turnStart, prov) { const board=prov.board, mover=turnStart.activePlayer, opp=opponent(mover), moverLines=findWinningLines(board,mover), oppLines=findWinningLines(board,opp); if(turnStart.checkedPlayer===mover&&oppLines.length) return {board,activePlayer:mover,checkedPlayer:mover,turnStart,provisional:{placements:[],effects:[],board:board.slice()},recentEffects:prov.effects,announcement:'',terminal:{winner:opp,reason:'DEFENSE_FAILED'}}; let checked=moverLines.length?opp:null; const nextStart={board:board.slice(),activePlayer:opp,checkedPlayer:checked,opening:false}; const legal=hasLegalFullTurn(nextStart); let terminal=null; if(!legal) terminal=checked===opp?{winner:mover,reason:'NO_LEGAL_TURN'}:{winner:null,reason:'DRAW'}; return {board,activePlayer:opp,checkedPlayer:checked,turnStart:nextStart,provisional:{placements:[],effects:[],board:board.slice()},recentEffects:prov.effects,announcement:'',terminal}; }
export function reduceGame(state, action) { if(action.type==='NEW_GAME') return createInitialGame(); if(state.terminal) return state; if(action.type==='RESET_TURN') return {...state,board:state.turnStart.board.slice(),provisional:{placements:[],effects:[],board:state.turnStart.board.slice()},announcement:''}; if(action.type==='UNDO_PLACEMENT'){ const latest=state.provisional.placements.at(-1); if(action.cell!==latest) return state; const placements=state.provisional.placements.slice(0,-1), effects=[]; let board=state.turnStart.board.slice(); for(const cell of placements){ const a=placementEffect(board,state.activePlayer,cell); if(!a.ok) return state; board=a.board; effects.push(a.effect); } return {...state,board,provisional:{placements,effects,board},announcement:''}; } if(action.type==='PLACE'){ const need=requiredPlacements(state.turnStart); if(state.provisional.placements.length>=need) return state; const a=placementEffect(state.provisional.board,state.activePlayer,action.cell); if(!a.ok) return {...state,announcement:a.reason}; if(need===2&&state.provisional.placements.length===0&&!getLegalPlacements(a.board,state.activePlayer).length) return {...state,announcement:'UNFINISHABLE_TURN'}; return {...state,board:a.board,provisional:{placements:[...state.provisional.placements,action.cell],effects:[...state.provisional.effects,a.effect],board:a.board},announcement:''}; } if(action.type==='COMMIT_TURN'){ if(state.provisional.placements.length!==requiredPlacements(state.turnStart)) return {...state,announcement:'Incomplete turn'}; return resolve(state.turnStart,state.provisional); } return state; }
