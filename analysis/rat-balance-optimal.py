"""Independent finite-state balance model for the unchanged rat encounter.
Assumes fair independent rolls, player HP 10, rat HP 8, Energy 3,
3d6 >= 10, damage 2 / prepared damage 4, and uniform hidden declarations.
Public state includes Health, rat Health, Energy, stored bonuses and visible cue.
Run: python3 analysis/rat-balance-optimal.py
"""
from pathlib import Path
import itertools,json
q=.625
states=list(itertools.product(range(2,11,2),range(2,9,2),range(4),[0,1],[0,1],['clear','prepare']))
V={s:0. for s in states}
def val(h,r,e,p,g,c):
 return 1. if r<=0 else 0. if h<=0 else V[h,r,e,p,g,c]
def hitbranches(g,d):
 x=q*(1-q if g else 1)
 return [(0,1-x),(d,x)]
def enemy(h,r,e,p,g):
 return .5*sum(w*val(h-d,r,e,p,0,'clear') for d,w in hitbranches(g,2))+.5*val(h,r,e,p,g,'prepare')
def action(s,a):
 h,r,e,p,g,c=s
 if a=='defend':e-=1;g=1
 if a=='prepare':p=1
 def branch(block):
  chance=q*(1-q if block else 1) if a=='attack' else 0
  dmg=2+2*p
  pp=0 if a=='attack' else p
  total=0
  for hit,w in [(1,chance),(0,1-chance)]:
   rr=r-dmg*hit
   if rr<=0: v=1
   elif c=='clear' or block:v=enemy(h,rr,e,pp,0 if block else g)
   else:v=sum(ww*val(h-d,rr,e,pp,0,'clear') for d,ww in hitbranches(g,4))
   total+=w*v
  return total
 return branch(False) if c=='clear' else .5*branch(True)+.5*branch(False)
for iteration in range(1000):
 delta=0
 for s in states:
  v=max(action(s,a) for a in ['attack','prepare']+(['defend'] if s[2] else []))
  delta=max(delta,abs(V[s]-v));V[s]=v
 if delta<1e-12:break
lowerInitial=enemy(10,8,3,0,0)
lowerV=V.copy()
V={s:1. for s in states}
for upperIteration in range(1000):
 delta=0
 for s in states:
  v=max(action(s,a) for a in ['attack','prepare']+(['defend'] if s[2] else []))
  delta=max(delta,abs(V[s]-v));V[s]=v
 if delta<1e-12:break
upperInitial=enemy(10,8,3,0,0)
assert abs(upperInitial-lowerInitial)<1e-10
print('Optimal initial win bracket',lowerInitial,upperInitial)
V=lowerV
P={','.join(map(str,s)):max(['attack','prepare']+(['defend'] if s[2] else []),key=lambda a:action(s,a)) for s in states}
print('iterations',iteration,'initial optimal win',enemy(10,8,3,0,0))
for s in [(10,8,3,0,0,'clear'),(10,8,3,0,0,'prepare'),(4,8,3,0,0,'prepare'),(2,2,3,0,0,'prepare'),(2,8,3,0,0,'prepare')]:
 print(s,{a:round(action(s,a),6) for a in ['attack','prepare','defend']})
json.dump({'initialWin':enemy(10,8,3,0,0),'policy':P},open(Path(__file__).with_name('rat-balance-optimal-policy.json'),'w'))
print('Optimal initial win by starting health',{h:round(enemy(h,8,3,0,0),6) for h in range(2,11,2)})
print('Optimal initial win by rat health',{r:round(enemy(10,r,3,0,0),6) for r in range(2,9,2)})
print('Defend optimal examples')
i=0
for s in states:
 if P[','.join(map(str,s))]=='defend' and not s[4]:
  print(s,{a:round(action(s,a),5) for a in ['attack','prepare','defend']});i+=1
  if i==8:break
initialOptimal=enemy(10,8,3,0,0)
def policy(s,name):
 h,r,e,p,g,c=s
 if name=='attack':return 'attack'
 if name=='alternate':return 'prepare' if not p and r>2 else 'attack'
 if name=='prepareOnTell':return 'prepare' if c=='prepare' and not p and r>2 else 'attack'
 if name=='defendOnTell':return 'defend' if c=='prepare' and e>0 else 'attack'
 if name=='bankDefense':return 'defend' if c=='clear' and not g and e>0 else 'attack'
 if name=='cautious':return 'defend' if c=='prepare' and r>2 and not g and e>0 else 'prepare' if c=='prepare' and not p and r>2 else 'attack'
fixed={}
for name in ['attack','alternate','prepareOnTell','defendOnTell','bankDefense','cautious','random']:
 V={s:0. for s in states}
 for iteration in range(1000):
  delta=0
  for s in states:
   if name=='random':
    actions=['attack','prepare']+(['defend'] if s[2] else []);v=sum(action(s,a) for a in actions)/len(actions)
   else:v=action(s,policy(s,name))
   delta=max(delta,abs(V[s]-v));V[s]=v
  if delta<1e-12:break
 fixed[name]=enemy(10,8,3,0,0)
print('Exact fixed policy win rates',fixed)
json.dump({'optimalWin':initialOptimal,'fixed':fixed},open(Path(__file__).with_name('rat-balance-exact-summary.json'),'w'),indent=2)
