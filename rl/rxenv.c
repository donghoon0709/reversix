// Reversix RL environment, mirroring the reference rules (nowyoullnever/ReverSIX).
// One action = one placement. A turn is two stones, except Black's first turn and
// except when no legal second stone exists (it is simply skipped).
#include <string.h>
#include <stdint.h>
#include <stdlib.h>

#define N 10
#define CELLS 100
#define SIXLEN 6
#define NPLANES 9
#define EMPTY 0
#define BLACK 1
#define WHITE 2
#define OTHER(p) (3 - (p))

static const int DR[8]={-1,-1,-1,0,0,1,1,1}, DC[8]={-1,0,1,-1,1,-1,0,1};
static const int AXR[4]={0,1,1,-1}, AXC[4]={1,0,1,1};
#define IDX(r,c) ((r)*N+(c))
#define IN(r,c) ((unsigned)(r)<(unsigned)N && (unsigned)(c)<(unsigned)N)

typedef struct {
  int8_t  board[CELLS];
  int8_t  player;      // side to move
  int8_t  checkBy;     // player who gave check (0 = none); the defender is the mover
  int8_t  placed;      // stones placed so far this turn
  int8_t  passes;      // consecutive passes
  int16_t first;       // first stone of this turn, -1 if none
  int16_t turnNumber;  // completed turns
  int8_t  terminal;
  int8_t  winner;      // 0 = draw / not decided
} RxState;

int rx_cells(void){ return CELLS; }
int rx_planes(void){ return NPLANES; }
int rx_statesize(void){ return (int)sizeof(RxState); }

static int flips_of(const int8_t*b,int p,int s,int*out){
  if(s<0||s>=CELLS||b[s]!=EMPTY) return 0;
  int r=s/N,c=s%N,n=0,o=OTHER(p);
  for(int d=0;d<8;d++){
    int dr=DR[d],dc=DC[d],rr=r+dr,cc=c+dc,st=n;
    while(IN(rr,cc)&&b[IDX(rr,cc)]==o){ out[n++]=IDX(rr,cc); rr+=dr; cc+=dc; }
    if(n>st && !(IN(rr,cc)&&b[IDX(rr,cc)]==p)) n=st;
  }
  return n;
}
static int legal_moves(const int8_t*b,int p,int*out){
  int n=0,fl[CELLS];
  for(int i=0;i<CELLS;i++) if(flips_of(b,p,i,fl)) out[n++]=i;
  return n;
}
/* maximal runs of EXACTLY six; an overline counts for nothing */
static int six_count(const int8_t*b,int p){
  int cnt=0;
  for(int a=0;a<4;a++){ int dr=AXR[a],dc=AXC[a];
    for(int r=0;r<N;r++) for(int c=0;c<N;c++){
      if(b[IDX(r,c)]!=p) continue;
      if(IN(r-dr,c-dc)&&b[IDX(r-dr,c-dc)]==p) continue;
      int len=0,rr=r,cc=c;
      while(IN(rr,cc)&&b[IDX(rr,cc)]==p){len++;rr+=dr;cc+=dc;}
      if(len==SIXLEN) cnt++;
    } }
  return cnt;
}
static void six_cells(const int8_t*b,int p,uint8_t*out){
  memset(out,0,CELLS);
  for(int a=0;a<4;a++){ int dr=AXR[a],dc=AXC[a];
    for(int r=0;r<N;r++) for(int c=0;c<N;c++){
      if(b[IDX(r,c)]!=p) continue;
      if(IN(r-dr,c-dc)&&b[IDX(r-dr,c-dc)]==p) continue;
      int len=0,rr=r,cc=c,tmp[CELLS];
      while(IN(rr,cc)&&b[IDX(rr,cc)]==p){tmp[len++]=IDX(rr,cc);rr+=dr;cc+=dc;}
      if(len==SIXLEN) for(int i=0;i<len;i++) out[tmp[i]]=1;
    } }
}
static void apply_move(int8_t*b,int p,int s){
  int fl[CELLS]; int k=flips_of(b,p,s,fl);
  b[s]=(int8_t)p; for(int i=0;i<k;i++) b[fl[i]]=(int8_t)p;
}
/* stones still expected this turn, accounting for the skip */
static int need_of(const RxState*s){
  if(s->turnNumber==0) return 1;
  if(s->placed==1){ int mv[CELLS]; return legal_moves(s->board,s->player,mv)?2:1; }
  return 2;
}

void rx_reset(RxState*s);
static void finish_turn(RxState*s){
  int mover=s->player, opp=OTHER(mover);
  if(s->checkBy && six_count(s->board,s->checkBy)){ s->terminal=1; s->winner=(int8_t)s->checkBy; return; }
  s->checkBy = six_count(s->board,mover) ? (int8_t)mover : 0;
  s->player=(int8_t)opp;
  s->turnNumber++;
  s->placed=0; s->first=-1;
}
static void settle_passes(RxState*s){
  int mv[CELLS];
  while(!s->terminal && legal_moves(s->board,s->player,mv)==0){
    s->passes++;
    finish_turn(s);
    if(!s->terminal && s->passes>=2 && !s->checkBy){
      int blk=0,wht=0;
      for(int i=0;i<CELLS;i++){ if(s->board[i]==BLACK)blk++; else if(s->board[i]==WHITE)wht++; }
      s->terminal=1; s->winner = (blk==wht)?0:(blk>wht?BLACK:WHITE);
    }
  }
}
void rx_reset(RxState*s){
  memset(s,0,sizeof(*s));
  s->board[44]=WHITE; s->board[55]=WHITE; s->board[45]=BLACK; s->board[54]=BLACK;
  s->player=BLACK; s->checkBy=0; s->placed=0; s->passes=0;
  s->first=-1; s->turnNumber=0; s->terminal=0; s->winner=0;
  settle_passes(s);
}

/* legal placements for the current sub-move.
   safe=1 additionally drops placements from which the turn cannot clear the checker's
   sixes -- an immediate loss. Falls back to raw legality when nothing survives. */
int rx_legal(const RxState*s, uint8_t*mask, int safe){
  memset(mask,0,CELLS);
  if(s->terminal) return 0;
  int p=s->player, mv[CELLS], mv2[CELLS], cnt=0;
  int n=legal_moves(s->board,p,mv);
  int mustDefend = safe && s->checkBy && s->checkBy==OTHER(p);
  int need=need_of(s);
  for(int i=0;i<n;i++){
    if(!mustDefend){ mask[mv[i]]=1; cnt++; continue; }
    int8_t t[CELLS]; memcpy(t,s->board,CELLS); apply_move(t,p,mv[i]);
    int ok=0;
    if(s->placed==1 || need==1){
      ok = !six_count(t,s->checkBy);
    } else {
      int m2=legal_moves(t,p,mv2);
      if(!m2) ok = !six_count(t,s->checkBy);          /* second stone is skipped */
      for(int j=0;j<m2 && !ok;j++){
        int8_t u[CELLS]; memcpy(u,t,CELLS); apply_move(u,p,mv2[j]);
        if(!six_count(u,s->checkBy)) ok=1;
      }
    }
    if(ok){ mask[mv[i]]=1; cnt++; }
  }
  if(!cnt && mustDefend) return rx_legal(s,mask,0);
  return cnt;
}

void rx_step(RxState*s,int cell){
  if(s->terminal) return;
  apply_move(s->board,s->player,cell);
  s->passes=0;
  s->placed++;
  if(s->placed < need_of(s)){ s->first=(int16_t)cell; return; }
  finish_turn(s);
  settle_passes(s);
}

void rx_encode(const RxState*s, float*out, int safe){
  memset(out,0,sizeof(float)*NPLANES*CELLS);
  int p=s->player,o=OTHER(p);
  float *my=out, *op=out+CELLS, *chk=out+2*CELLS, *ol=out+3*CELLS,
        *pl=out+4*CELLS, *fst=out+5*CELLS, *nd=out+6*CELLS, *lg=out+7*CELLS, *one=out+8*CELLS;
  for(int i=0;i<CELLS;i++){ if(s->board[i]==p) my[i]=1.f; else if(s->board[i]==o) op[i]=1.f; one[i]=1.f; }
  int checked = s->checkBy && s->checkBy==o;
  if(checked) for(int i=0;i<CELLS;i++) chk[i]=1.f;
  uint8_t sc[CELLS]; six_cells(s->board,o,sc);
  for(int i=0;i<CELLS;i++) if(sc[i]) ol[i]=1.f;
  if(s->placed) for(int i=0;i<CELLS;i++) pl[i]=1.f;
  if(s->first>=0) fst[s->first]=1.f;
  if(need_of(s)==2) for(int i=0;i<CELLS;i++) nd[i]=1.f;
  uint8_t m[CELLS]; rx_legal(s,m,safe);
  for(int i=0;i<CELLS;i++) if(m[i]) lg[i]=1.f;
}

void rx_reset_batch(RxState*s,int n){ for(int i=0;i<n;i++) rx_reset(&s[i]); }
void rx_encode_batch(const RxState*s,int n,float*out,int safe){
  for(int i=0;i<n;i++) rx_encode(&s[i], out+(size_t)i*NPLANES*CELLS, safe);
}
void rx_legal_batch(const RxState*s,int n,uint8_t*mask,int safe,int32_t*counts){
  for(int i=0;i<n;i++) counts[i]=rx_legal(&s[i], mask+(size_t)i*CELLS, safe);
}
void rx_step_batch(RxState*s,int n,const int32_t*cells){
  for(int i=0;i<n;i++) if(cells[i]>=0) rx_step(&s[i],cells[i]);
}

/* ---- baselines -------------------------------------------------------------
   Window potential, adapted to "SIX is exactly six": a fully owned window is NOT
   scored here (an overline would otherwise be counted twice and look good). Actual
   sixes are scored through six_count, so extending your own six to seven correctly
   reads as losing the six.                                                     */
static const float WGT[6]={0.f,1.f,5.f,25.f,120.f,600.f};
static float eval_board(const int8_t*b,int p){
  int o=OTHER(p); float s=0.f;
  for(int a=0;a<4;a++){ int dr=AXR[a],dc=AXC[a];
    for(int r=0;r<N;r++) for(int c=0;c<N;c++){
      if(!IN(r+dr*(SIXLEN-1),c+dc*(SIXLEN-1))) continue;
      int mine=0,they=0;
      for(int i=0;i<SIXLEN;i++){ int v=b[IDX(r+dr*i,c+dc*i)]; if(v==p)mine++; else if(v==o)they++; }
      if(!they&&mine&&mine<SIXLEN) s+=WGT[mine];
      else if(!mine&&they&&they<SIXLEN) s-=WGT[they];
    } }
  s += 6000.f*six_count(b,p) - 6000.f*six_count(b,o);
  int m=0,t=0; for(int i=0;i<CELLS;i++){ if(b[i]==p)m++; else if(b[i]==o)t++; }
  return s + (m-t)*0.5f;
}

static uint32_t xs(uint32_t*st){ uint32_t x=*st; x^=x<<13; x^=x>>17; x^=x<<5; return *st=x; }

int rx_random_move(const RxState*s,uint32_t*rngstate){
  uint8_t m[CELLS]; int cnt=rx_legal(s,m,1);
  if(!cnt) return -1;
  int pick=(int)(xs(rngstate)%(uint32_t)cnt);
  for(int i=0;i<CELLS;i++) if(m[i]&&pick--==0) return i;
  return -1;
}

/* Best complete turn under the heuristic. out[2]; out[1] = -1 when only one stone is
   played (Black's opening, or the second stone being skipped). Never returns "no move"
   for a position that still has legal placements: a lost position is played out. */
int rx_greedy_turn(const RxState*s,int32_t*out,float eps,uint32_t*rngstate){
  if(s->terminal) return 0;
  int p=s->player, mv[CELLS], mv2[CELLS];
  static int32_t c1[40000],c2[40000]; static float sc[40000];
  int nCand=0;
  for(int pass=0; pass<2 && !nCand; pass++){
    int wantDefence = (pass==0) && s->checkBy && s->checkBy==OTHER(p);
    uint8_t root[CELLS]; rx_legal(s,root,0);
    int n=0; for(int i=0;i<CELLS;i++) if(root[i]) mv[n++]=i;
    int single = (s->placed==1) || (need_of(s)==1);
    for(int i=0;i<n;i++){
      int8_t t[CELLS]; memcpy(t,s->board,CELLS); apply_move(t,p,mv[i]);
      if(single){
        if(wantDefence && six_count(t,s->checkBy)) continue;
        if(nCand<40000){ c1[nCand]=mv[i]; c2[nCand]=-1; sc[nCand]=eval_board(t,p); nCand++; }
        continue;
      }
      int m2=legal_moves(t,p,mv2);
      if(!m2){                                     /* second stone skipped */
        if(wantDefence && six_count(t,s->checkBy)) continue;
        if(nCand<40000){ c1[nCand]=mv[i]; c2[nCand]=-1; sc[nCand]=eval_board(t,p); nCand++; }
        continue;
      }
      for(int j=0;j<m2;j++){
        int8_t u[CELLS]; memcpy(u,t,CELLS); apply_move(u,p,mv2[j]);
        if(wantDefence && six_count(u,s->checkBy)) continue;
        if(nCand<40000){ c1[nCand]=mv[i]; c2[nCand]=mv2[j]; sc[nCand]=eval_board(u,p); nCand++; }
      }
    }
  }
  if(!nCand) return 0;
  uint32_t x=xs(rngstate);
  int best;
  if((double)(x&0xFFFFFF)/16777216.0 < eps) best=(int)(x%(uint32_t)nCand);
  else { best=0; for(int i=1;i<nCand;i++) if(sc[i]>sc[best]) best=i; }
  out[0]=c1[best]; out[1]=c2[best];
  return c2[best]>=0?2:1;
}
