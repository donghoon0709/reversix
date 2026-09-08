// Reversix RL environment (current rules), exposed as a shared library.
// One "action" = one placement. A turn is 1 or 2 placements by the same player.
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#define MAXN 19
#define MAXCELLS (MAXN*MAXN)
#define NPLANES 9
static int N=10, K=6, CELLS=100;
static const int DR[8]={-1,-1,-1,0,0,1,1,1}, DC[8]={-1,0,1,-1,1,-1,0,1};
static const int AXR[4]={0,1,1,1}, AXC[4]={1,0,1,-1};
#define IDX(r,c) ((r)*N+(c))
#define IN(r,c) ((unsigned)(r)<(unsigned)N && (unsigned)(c)<(unsigned)N)
typedef struct {
  int8_t  board[MAXCELLS];   // 0 empty, 1 black, 2 white
  int8_t  player;            // side to move (1/2)
  int8_t  checked;           // side to move is in check
  int8_t  placed;            // placements already made this turn (0/1)
  int8_t  opening;           // this turn is black's 1-stone opening
  int16_t first;             // first placement cell this turn, -1 if none
  int8_t  need;              // placements required THIS turn, fixed at turn start
  int8_t  terminal;          // 0 running, 1 finished
  int8_t  winner;            // 0 draw, 1 black, 2 white (valid when terminal)
  int16_t turn;              // completed turns so far
} RxState;
void rx_config(int n,int k){ N=n; K=k; CELLS=n*n; }
int  rx_cells(void){ return CELLS; }
int  rx_planes(void){ return NPLANES; }
int  rx_statesize(void){ return (int)sizeof(RxState); }
static int flips_of(const int8_t*b,int p,int s,int*out){
  int r=s/N,c=s%N,n=0,o=3-p;
  for(int d=0;d<8;d++){
    int dr=DR[d],dc=DC[d],rr=r+dr,cc=c+dc,st=n;
    while(IN(rr,cc)&&b[IDX(rr,cc)]==o){ out[n++]=IDX(rr,cc); rr+=dr; cc+=dc; }
    if(n>st && !(IN(rr,cc)&&b[IDX(rr,cc)]==p)) n=st;
  }
  return n;
}
// The forbidden-second-placement rule was removed from the game: a turn may now
// bracket a long opposing run and manufacture a K-line in one turn.
static int forbidden(const int8_t*b,int s1,int s2,int p){ (void)b;(void)s1;(void)s2;(void)p; return 0; }
static int has_line(const int8_t*b,int p){
  for(int a=0;a<4;a++){ int dr=AXR[a],dc=AXC[a];
    for(int r=0;r<N;r++) for(int c=0;c<N;c++){
      int er=r+dr*(K-1), ec=c+dc*(K-1); if(!IN(er,ec)) continue;
      int ok=1; for(int i=0;i<K;i++) if(b[IDX(r+dr*i,c+dc*i)]!=p){ok=0;break;}
      if(ok) return 1; } }
  return 0;
}
// cells belonging to at least one K-window of p
static void line_cells(const int8_t*b,int p,uint8_t*out){
  memset(out,0,CELLS);
  for(int a=0;a<4;a++){ int dr=AXR[a],dc=AXC[a];
    for(int r=0;r<N;r++) for(int c=0;c<N;c++){
      int er=r+dr*(K-1), ec=c+dc*(K-1); if(!IN(er,ec)) continue;
      int ok=1; for(int i=0;i<K;i++) if(b[IDX(r+dr*i,c+dc*i)]!=p){ok=0;break;}
      if(ok) for(int i=0;i<K;i++) out[IDX(r+dr*i,c+dc*i)]=1; } }
}
static int empties(const int8_t*b){int n=0;for(int i=0;i<CELLS;i++)if(!b[i])n++;return n;}
// required placements, decided at TURN START (matches rules.js requiredPlacements(turnStart))
static int need_of(const RxState*s){ return s->need; }
static int need_at_turn_start(const int8_t*b,int opening){ return opening?1:(empties(b)==1?1:2); }
// can `p` complete a whole turn from board b (needing `need` placements)?
static int any_turn(int8_t*b,int p,int need){
  int f1[MAXCELLS],f2[MAXCELLS];
  for(int s1=0;s1<CELLS;s1++){
    if(b[s1])continue; int k1=flips_of(b,p,s1,f1); if(!k1)continue;
    if(need==1) return 1;
    b[s1]=p; for(int i=0;i<k1;i++) b[f1[i]]=p;
    int found=0;
    for(int s2=0;s2<CELLS&&!found;s2++){
      if(b[s2])continue; if(forbidden(b,s1,s2,p))continue;
      if(flips_of(b,p,s2,f2)) found=1;
    }
    b[s1]=0; for(int i=0;i<k1;i++) b[f1[i]]=3-p;
    if(found) return 1;
  }
  return 0;
}
void rx_reset(RxState*s){
  memset(s,0,sizeof(*s));
  int r0=(N-1)/2;
  s->board[IDX(r0,r0)]=1; s->board[IDX(r0,r0+1)]=2;
  s->board[IDX(r0+1,r0)]=2; s->board[IDX(r0+1,r0+1)]=1;
  s->player=1; s->checked=0; s->placed=0; s->opening=1; s->first=-1;
  s->need=1;
  s->terminal=0; s->winner=0; s->turn=0;
}
// legal placements for the current sub-move.
// safe=1 -> when in check, drop placements from which the turn cannot break every
// opponent K-line (an immediate loss). Falls back to raw legality if nothing survives.
int rx_legal(const RxState*s, uint8_t*mask, int safe){
  memset(mask,0,CELLS);
  if(s->terminal) return 0;
  int8_t b[MAXCELLS]; memcpy(b,s->board,CELLS);
  int p=s->player, o=3-p, need=need_of(s), f1[MAXCELLS], f2[MAXCELLS], cnt=0;
  int mustDefend = s->checked && safe;
  if(s->placed==1){                       // choosing the second stone
    for(int s2=0;s2<CELLS;s2++){
      if(b[s2])continue;
      if(forbidden(b,s->first,s2,p))continue;
      int k=flips_of(b,p,s2,f2); if(!k)continue;
      if(mustDefend){
        for(int i=0;i<k;i++) b[f2[i]]=p; b[s2]=p;
        int bad=has_line(b,o);
        b[s2]=0; for(int i=0;i<k;i++) b[f2[i]]=o;
        if(bad) continue;
      }
      mask[s2]=1; cnt++;
    }
  } else {                                // choosing the first stone of the turn
    for(int s1=0;s1<CELLS;s1++){
      if(b[s1])continue;
      int k1=flips_of(b,p,s1,f1); if(!k1)continue;
      b[s1]=p; for(int i=0;i<k1;i++) b[f1[i]]=p;
      int ok;
      if(need==1) ok = mustDefend ? !has_line(b,o) : 1;
      else {   // a first stone is legal only if the TURN can be completed:
        ok=0;
        for(int s2=0;s2<CELLS&&!ok;s2++){
          if(b[s2])continue; if(forbidden(b,s1,s2,p))continue;
          int k2=flips_of(b,p,s2,f2); if(!k2)continue;
          if(!mustDefend){ ok=1; break; }
          for(int i=0;i<k2;i++) b[f2[i]]=p; b[s2]=p;
          if(!has_line(b,o)) ok=1;
          b[s2]=0; for(int i=0;i<k2;i++) b[f2[i]]=o;
        }
      }
      b[s1]=0; for(int i=0;i<k1;i++) b[f1[i]]=o;
      if(ok){ mask[s1]=1; cnt++; }
    }
  }
  if(cnt==0 && mustDefend) return rx_legal(s,mask,0);   // every move loses: allow all
  return cnt;
}
// apply one placement; resolves the turn when the quota is met
void rx_step(RxState*s,int cell){
  if(s->terminal) return;
  int p=s->player,o=3-p,fl[MAXCELLS];
  int k=flips_of(s->board,p,cell,fl);
  s->board[cell]=p; for(int i=0;i<k;i++) s->board[fl[i]]=p;
  int need=s->need;
  s->placed++;
  if(s->placed<need){ s->first=(int16_t)cell; return; }
  // turn complete -> resolve
  s->turn++;
  if(s->checked && has_line(s->board,o)){ s->terminal=1; s->winner=(int8_t)o; return; }
  int myLine=has_line(s->board,p);
  int nextNeed = need_at_turn_start(s->board,0);
  if(!any_turn(s->board,o,nextNeed)){
    s->terminal=1; s->winner = myLine ? (int8_t)p : 0; return;
  }
  s->player=(int8_t)o; s->checked=(int8_t)myLine;
  s->placed=0; s->first=-1; s->opening=0; s->need=(int8_t)nextNeed;
}
// encode planes for the side to move; out has NPLANES*CELLS floats
void rx_encode(const RxState*s, float*out, int safe){
  memset(out,0,sizeof(float)*NPLANES*CELLS);
  int p=s->player,o=3-p;
  float *my=out, *op=out+CELLS, *chk=out+2*CELLS, *ol=out+3*CELLS,
        *pl=out+4*CELLS, *fst=out+5*CELLS, *nd=out+6*CELLS, *lg=out+7*CELLS, *one=out+8*CELLS;
  for(int i=0;i<CELLS;i++){ if(s->board[i]==p) my[i]=1.f; else if(s->board[i]==o) op[i]=1.f; one[i]=1.f; }
  if(s->checked) for(int i=0;i<CELLS;i++) chk[i]=1.f;
  uint8_t lc[MAXCELLS]; line_cells(s->board,o,lc);
  for(int i=0;i<CELLS;i++) if(lc[i]) ol[i]=1.f;
  if(s->placed) for(int i=0;i<CELLS;i++) pl[i]=1.f;
  if(s->first>=0) fst[s->first]=1.f;
  if(need_of(s)==2) for(int i=0;i<CELLS;i++) nd[i]=1.f;
  uint8_t m[MAXCELLS]; rx_legal(s,m,safe);
  for(int i=0;i<CELLS;i++) if(m[i]) lg[i]=1.f;
}
// ---- batch helpers (avoid Python-loop overhead) ----
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
// ---- heuristic baseline: window-potential greedy (placement level) ----
static const float WGT[9]={0.f,1.f,5.f,25.f,120.f,600.f,3000.f,15000.f,60000.f};
static float eval_board(const int8_t*b,int p){
  int o=3-p; float s=0.f;
  for(int a=0;a<4;a++){ int dr=AXR[a],dc=AXC[a];
    for(int r=0;r<N;r++) for(int c=0;c<N;c++){
      if(!IN(r+dr*(K-1),c+dc*(K-1))) continue;
      int mine=0,they=0;
      for(int i=0;i<K;i++){ int v=b[IDX(r+dr*i,c+dc*i)]; if(v==p)mine++; else if(v==o)they++; }
      if(!they&&mine) s+=WGT[mine]; else if(!mine&&they) s-=WGT[they]; } }
  int m=0,t=0; for(int i=0;i<CELLS;i++){ if(b[i]==p)m++; else if(b[i]==o)t++; }
  return s+(m-t)*0.5f;
}
// returns chosen cell, or -1 if none. eps in [0,1] picks a uniform random legal move.
int rx_heuristic_move(const RxState*s,float eps,uint32_t*rngstate){
  uint8_t m[MAXCELLS];
  int cnt=rx_legal(s,m,1);
  if(!cnt) return -1;
  uint32_t x=*rngstate; x^=x<<13; x^=x>>17; x^=x<<5; *rngstate=x;
  if((double)(x&0xFFFFFF)/16777216.0 < eps){
    int pick=(int)(x%(uint32_t)cnt);
    for(int i=0;i<CELLS;i++) if(m[i]&&pick--==0) return i;
  }
  int p=s->player,best=-1,fl[MAXCELLS]; float bs=-1e30f;
  int8_t b[MAXCELLS]; memcpy(b,s->board,CELLS);
  for(int i=0;i<CELLS;i++){
    if(!m[i]) continue;
    int k=flips_of(b,p,i,fl); b[i]=p; for(int j=0;j<k;j++) b[fl[j]]=p;
    float sc=eval_board(b,p);
    if(has_line(b,p)) sc+=5000.f;
    b[i]=0; for(int j=0;j<k;j++) b[fl[j]]=3-p;
    if(sc>bs){ bs=sc; best=i; }
  }
  return best;
}
int rx_random_move(const RxState*s,uint32_t*rngstate){
  uint8_t m[MAXCELLS]; int cnt=rx_legal(s,m,1);
  if(!cnt) return -1;
  uint32_t x=*rngstate; x^=x<<13; x^=x>>17; x^=x<<5; *rngstate=x;
  int pick=(int)(x%(uint32_t)cnt);
  for(int i=0;i<CELLS;i++) if(m[i]&&pick--==0) return i;
  return -1;
}

// Turn-level greedy: score every COMPLETE turn (the unit that actually matters here).
// out[2]; out[1] = -1 when only one placement is returned. Returns how many were written.
// Handles being called mid-turn (placed==1), and never returns "no move" for a position
// that still has legal placements -- a lost position must still be played out.
int rx_greedy_turn(const RxState*s,int32_t*out,float eps,uint32_t*rngstate){
  if(s->terminal) return 0;
  int p=s->player,o=3-p;
  int8_t b[MAXCELLS]; memcpy(b,s->board,CELLS);
  int f1[MAXCELLS],f2[MAXCELLS];
  static int32_t c1[40000],c2[40000]; static float sc[40000];
  uint8_t root[MAXCELLS];
  int pass, nCand=0;

  for(pass=0; pass<2 && !nCand; pass++){
    int wantDefence = s->checked && (pass==0);   // 2nd pass drops it: the position is lost
    rx_legal(s,root,1);
    if(s->placed>=1){                            // mid-turn: pick only the remaining stone
      for(int s2=0;s2<CELLS;s2++){
        if(!root[s2]) continue;
        int k2=flips_of(b,p,s2,f2); if(!k2) continue;
        b[s2]=p; for(int i=0;i<k2;i++) b[f2[i]]=p;
        int bad = wantDefence && has_line(b,o);
        float v=eval_board(b,p); if(has_line(b,p)) v+=5000.f;
        b[s2]=0; for(int i=0;i<k2;i++) b[f2[i]]=o;
        if(bad) continue;
        if(nCand<40000){ c1[nCand]=s2; c2[nCand]=-1; sc[nCand]=v; nCand++; }
      }
      continue;
    }
    int need=need_of(s);
    for(int s1=0;s1<CELLS;s1++){
      if(!root[s1]) continue;
      int k1=flips_of(b,p,s1,f1); if(!k1) continue;
      b[s1]=p; for(int i=0;i<k1;i++) b[f1[i]]=p;
      if(need==1){
        if(!(wantDefence && has_line(b,o))){
          float v=eval_board(b,p); if(has_line(b,p)) v+=5000.f;
          if(nCand<40000){ c1[nCand]=s1; c2[nCand]=-1; sc[nCand]=v; nCand++; }
        }
      } else {
        for(int s2=0;s2<CELLS;s2++){
          if(b[s2]) continue;
          if(forbidden(b,s1,s2,p)) continue;
          int k2=flips_of(b,p,s2,f2); if(!k2) continue;
          b[s2]=p; for(int i=0;i<k2;i++) b[f2[i]]=p;
          int bad = wantDefence && has_line(b,o);
          float v=eval_board(b,p); if(has_line(b,p)) v+=5000.f;
          b[s2]=0; for(int i=0;i<k2;i++) b[f2[i]]=o;
          if(bad) continue;
          if(nCand<40000){ c1[nCand]=s1; c2[nCand]=s2; sc[nCand]=v; nCand++; }
        }
      }
      b[s1]=0; for(int i=0;i<k1;i++) b[f1[i]]=o;
    }
  }
  if(!nCand) return 0;                            // genuinely no legal placement
  uint32_t x=*rngstate; x^=x<<13; x^=x>>17; x^=x<<5; *rngstate=x;
  int best;
  if((double)(x&0xFFFFFF)/16777216.0 < eps){ best=(int)(x%(uint32_t)nCand); }
  else { best=0; for(int i=1;i<nCand;i++) if(sc[i]>sc[best]) best=i; }
  out[0]=c1[best]; out[1]=c2[best];
  return c2[best]>=0?2:1;
}
