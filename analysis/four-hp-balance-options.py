"""Independent four-HP rat design comparison against a frozen published snapshot.

Run: python3 analysis/four-hp-balance-options.py
No production imports or edits. Fair IID dice; hidden declarations marginalized,
so every exported decision uses public state only. Bounds start at 0 and 1 and
must agree globally below 1e-10; quoted win rates are midpoint estimates.
"""
import hashlib
import itertools
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'checked-preparation-project-snapshot.json'
SOURCE_SHA = '8b2b56fec0e56b2b367cedb30ad606f01c440c2a4a9d029439ec3e3644b38900'
NAMES = ['attack', 'alternate', 'prepareOnTell', 'defendOnTell', 'bankDefense', 'cautious', 'random']
ACTIONS = ['attack', 'prepare', 'defend']
TOL = 2e-12


def dice_success(target):
    return sum(sum(d) >= target for d in itertools.product(range(1, 7), repeat=3)) / 216


def validate_source():
    raw = SOURCE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SOURCE_SHA
    source = json.loads(raw)
    cards = {c['id']: c for c in source['library']}
    variables = {v['id']: v for v in source['variables']}
    assert variables['health']['initial'] == variables['health']['max'] == 10
    assert variables['energy']['initial'] == 3 and variables['energy']['max'] == 10
    assert variables['agility']['initial'] == variables['composure']['initial'] == 3
    rat = cards['rat']
    assert rat['health'] == 8 and rat['mechanics'] == 'opposed-preparation'
    assert not rat.get('variables') and not rat.get('stats')
    bite, prep = rat['actions']
    assert bite['type'] == 'attack' and bite['check'] == {'pool': [{'sides': 6, 'count': 3}], 'modifier': 0, 'target': 10}
    assert bite['attack']['damage'] == {'min': 2, 'max': 2}
    assert prep['resolution'] == 'direct' and prep['preparationBonus'] == 2
    for cid, stat in [('alternative-attack', 'agility'), ('alternative-preparation', 'composure')]:
        assert cards[cid]['resolution'] == 'check'
        assert cards[cid]['check'] == {'mode': 'stat', 'modifierVariable': stat, 'difficulty': 3}
    assert cards['alternative-attack']['attack']['damage'] == {'min': 2, 'max': 2}
    assert cards['alternative-preparation']['preparationBonus'] == 2
    assert cards['alternative-defend']['resolution'] == 'direct'
    assert cards['alternative-defend']['costs'] == [{'source': 'variable', 'key': 'energy', 'amount': 1}]
    return source


def fixed_action(name, state):
    h, r, e, p, g, cue = state
    tell = cue == 'prepare'
    if name == 'alternate' and not p and r > 2:
        return 'prepare'
    if name == 'prepareOnTell' and tell and not p and r > 2:
        return 'prepare'
    if name == 'defendOnTell' and tell and e:
        return 'defend'
    if name == 'bankDefense' and not tell and not g and e:
        return 'defend'
    if name == 'cautious':
        if tell and r > 2 and not g and e:
            return 'defend'
        if tell and not p and r > 2:
            return 'prepare'
    return 'attack'


PROFILES = {
    'baseline': {'description': 'Control: checked Prepare +2, consumed on any Attack attempt.'},
    'autoPrepare': {'description': 'Prepare always succeeds; +2 damage and the same turn cost.'},
    'durablePrepare': {'description': 'Checked Prepare +2; consumed only when Attack deals positive damage.'},
    'focusedPrepare': {'description': 'Checked Prepare grants +2 damage and +2 attack check modifier; consumed on Attack attempt.'},
    'partialDefend': {'description': 'Player Defend costs 1 energy and guarantees damage reduction 2 for the next enemy attack, with no defense roll.'},
    'granularDamage': {'description': 'Player base damage 1 and checked Prepare bonus 3; rat bite damage 1 and charge damage 2.'},
}


class Model:
    def __init__(self, agility=3, composure=3, profile='baseline'):
        assert profile in PROFILES
        self.profile = profile
        self.pa = dice_success(13-agility)
        self.pap = dice_success(13-agility-2) if profile == 'focusedPrepare' else self.pa
        self.pp = 1. if profile == 'autoPrepare' else dice_success(13-composure)
        self.q = dice_success(10)
        self.base, self.bonus, self.bite, self.charge = (1, 3, 1, 2) if profile == 'granularDamage' else (2, 2, 2, 4)
        self.states = list(itertools.product(range(1, 11), range(1, 5), range(11), [0, 1], [0, 1], ['clear', 'prepare']))
        self.index = {s: i for i, s in enumerate(self.states)}
        self.dead, self.win = len(self.states), len(self.states)+1
        self.edges = [[self.transitions(s, a) if a != 'defend' or s[2] else None for a in ACTIONS] for s in self.states]

    def dest(self, h, r, e, p, g, cue):
        return self.win if r <= 0 else self.dead if h <= 0 else self.index[h, r, e, p, g, cue]

    def incoming(self, guard, damage):
        if guard and self.profile == 'partialDefend':
            return [(0, 1-self.q), (max(0, damage-2), self.q)]
        hurt = self.q * (1-self.q if guard else 1)
        return [(0, 1-hurt), (damage, hurt)]

    def enemy_edges(self, h, r, e, p, g):
        if r <= 0 or h <= 0:
            return [(self.dest(h, r, e, p, g, 'clear'), 1.)]
        return [(self.dest(h-d, r, e, p, 0, 'clear'), .5*w) for d, w in self.incoming(g, self.bite)] + [(self.dest(h, r, e, p, g, 'prepare'), .5)]

    def transitions(self, state, action):
        h, r, e, p, g, cue = state
        if action == 'defend':
            assert e > 0
            e, g = e-1, 1
        preps = [(1, self.pp), (p, 1-self.pp)] if action == 'prepare' else [(p, 1.)]
        result = {}
        for prepared, pw in preps:
            for block, bw in ([(False, 1.)] if cue == 'clear' else [(True, .5), (False, .5)]):
                hit = (self.pap if prepared else self.pa)*(1-self.q if block else 1.) if action == 'attack' else 0.
                for landed, hw in [(True, hit), (False, 1-hit)]:
                    after_p = 0 if action == 'attack' and (landed or self.profile != 'durablePrepare') else prepared
                    rat = r-(self.base+self.bonus*prepared)*landed
                    if rat <= 0:
                        edges = [(self.win, 1.)]
                    elif cue == 'clear' or block:
                        edges = self.enemy_edges(h, rat, e, after_p, 0 if block else g)
                    else:
                        edges = [(self.dest(h-d, rat, e, after_p, 0, 'clear'), w) for d, w in self.incoming(g, self.charge)]
                    for dest, weight in edges:
                        result[dest] = result.get(dest, 0.) + pw*bw*hw*weight
        result = [(dest, w) for dest, w in result.items() if w]
        assert abs(sum(w for _, w in result)-1) < 1e-14
        return result

    def solve(self, name):
        selected = []
        for state, edges in zip(self.states, self.edges):
            if name == 'random':
                allowed = [ed for ed in edges if ed is not None]
                merged = {}
                for ed in allowed:
                    for dest, w in ed:
                        merged[dest] = merged.get(dest, 0.) + w/len(allowed)
                selected.append([list(merged.items())])
            elif name in NAMES:
                selected.append([edges[ACTIONS.index(fixed_action(name, state))]])
            else:
                selected.append([ed for action, ed in zip(ACTIONS, edges) if ed is not None and not (name == 'optimalWithoutPrepare' and action == 'prepare') and not (name == 'optimalWithoutDefend' and action == 'defend')])
        lo = [0.]*len(self.states)+[0., 1.]
        hi = [1.]*len(self.states)+[0., 1.]
        for iteration in range(1, 10001):
            # Gauss-Seidel sweeps preserve monotone bounding sequences.
            for i, alternatives in enumerate(selected):
                lo[i] = max(sum(w*lo[d] for d, w in ed) for ed in alternatives)
                hi[i] = max(sum(w*hi[d] for d, w in ed) for ed in alternatives)
            gap = max(b-a for a, b in zip(lo, hi))
            assert gap >= -1e-13
            if gap < TOL:
                break
        else:
            raise AssertionError(f'{name} failed global bound convergence')
        values = [(a+b)/2 for a, b in zip(lo, hi)]
        policy = None
        if name.startswith('optimal'):
            policy = {}
            for s, edges in zip(self.states, self.edges):
                allowed = [(a, ed) for a, ed in zip(ACTIONS, edges) if ed is not None and not (name == 'optimalWithoutPrepare' and a == 'prepare') and not (name == 'optimalWithoutDefend' and a == 'defend')]
                action_values = [(a, sum(w*values[d] for d, w in ed)) for a, ed in allowed]
                best = max(v for _, v in action_values)
                # Numerically tied actions favor attack, then prepare, then defend.
                policy[','.join(map(str, s))] = next(a for a, v in action_values if v >= best-1e-12)
        return values, policy, {'iterations': iteration, 'maxUpperLowerGap': gap}

    def initial(self, values, hp, rat, energy):
        return sum(w*values[d] for d, w in self.enemy_edges(hp, rat, energy, 0, 0))


def main():
    validate_source()
    started = time.monotonic()
    report = {
        'source': {'path': str(SOURCE.relative_to(ROOT.parent)), 'sha256': SOURCE_SHA, 'fieldsValidated': True, 'publishedRatHealth': 8, 'modeledInitialRatHealth': 4},
        'method': {
            'description': 'Exact fair IID dice branch probabilities; numerical absorbing MDP solution certified by global lower and upper bounds.',
            'stateKey': '[hp,rat,energy,prepared01,guard01,cue] joined by commas',
            'stateCountPerModel': 3520, 'initialEnemyActs': True,
            'stateDomain': {'playerHealth': [1, 10], 'ratHealth': [1, 4], 'energy': [0, 10], 'prepared': [0, 1], 'guard': [0, 1], 'cue': ['clear', 'prepare']},
            'declarations': {'bite': .5, 'hiddenBlock': .25, 'hiddenCharge': .25},
            'playerAttackCheck': '3d6 + Agility >= 13; focusedPrepare adds 2 when prepared',
            'playerPrepareCheck': '3d6 + Composure >= 13; autoPrepare always succeeds',
            'ratAndFullDefenseCheck': 'fixed 3d6 >= 10, independent of player stats',
            'failedPrepare': 'spends turn and preserves existing preparation',
            'guardLifetime': 'banked through actions until next enemy attack, including a miss, or hidden block resolution; hidden block wipes guard even when its defense roll fails',
            'fixedStrategies': 'Identical public-state helper definitions to checked-preparation-balance-model.py, including its fixed r>2 Prepare conditions.',
            'boundsTolerance': TOL, 'policyTieTolerance': 1e-12,
            'scope': 'Win probability only; no time, remaining-health or remaining-energy objective. Numerical values, not symbolic rational solutions. No editor, browser or device verification.'},
        'profiles': {}, 'scenarios': []}
    for profile, details in PROFILES.items():
        profile_output = {'rules': dict(details, initialRatHealth=4, playerHealth=10, playerHealthCap=10, energyCap=10, prepareCost='one turn', defendEnergyCost=1,
            prepareAlwaysSucceeds=profile == 'autoPrepare',
            prepareConsumption='positiveDamage' if profile == 'durablePrepare' else 'attackAttempt',
            preparedAttackModifier=2 if profile == 'focusedPrepare' else 0,
            playerDefenseMode='guaranteedDamageReduction' if profile == 'partialDefend' else 'checkedFullBlock',
            playerDamageReduction=2 if profile == 'partialDefend' else None,
            playerBaseDamage=1 if profile == 'granularDamage' else 2,
            prepareBonus=3 if profile == 'granularDamage' else 2,
            ratBiteDamage=1 if profile == 'granularDamage' else 2,
            ratChargeDamage=2 if profile == 'granularDamage' else 4,
            ratDefenseMode='checkedFullBlock'), 'models': {}}
        report['profiles'][profile] = profile_output
        for agility, composure in [(3, 3), (3, 4), (4, 3)]:
            key = f'{agility}_{composure}'
            m = Model(agility, composure, profile)
            output = {'agility': agility, 'composure': composure, 'pAttack': m.pa, 'pPreparedAttack': m.pap, 'pPrepare': m.pp, 'pDefense': m.q, 'pRatHit': m.q, 'convergence': {}}
            output['playerBaseDamage'], output['prepareBonus'], output['ratBiteDamage'], output['ratChargeDamage'] = m.base, m.bonus, m.bite, m.charge
            profile_output['models'][key] = output
            solutions = {}
            for name in NAMES+['optimal', 'optimalWithoutPrepare', 'optimalWithoutDefend']:
                vals, policy, convergence = m.solve(name)
                solutions[name] = vals
                output['convergence'][name] = convergence
                if policy:
                    output[{'optimal': 'optimalPolicy', 'optimalWithoutPrepare': 'noPreparePolicy', 'optimalWithoutDefend': 'noDefendPolicy'}[name]] = policy
            starts = [(10, 4, 3), (10, 4, 10)]
            if key == '3_3':
                starts += [(8, 4, 3), (8, 4, 10)]
            for hp, rat, energy in starts:
                report['scenarios'].append({'id': f'{profile}_hp{hp}_rat{rat}_e{energy}_a{agility}_c{composure}', 'profile': profile, 'playerHealth': hp, 'ratHealth': rat, 'startingEnergy': energy, 'agility': agility, 'composure': composure, 'rates': {n: m.initial(v, hp, rat, energy) for n, v in solutions.items()}})
            print(f'Completed {profile}/{key} after {time.monotonic()-started:.1f}s', flush=True)
    for profile_output in report['profiles'].values():
        for output in profile_output['models'].values():
            for mapping in ['optimalPolicy', 'noPreparePolicy', 'noDefendPolicy']:
                assert len(output[mapping]) == 3520
                assert all(a in ACTIONS and (a != 'defend' or int(k.split(',')[2]) > 0) for k, a in output[mapping].items())
            assert 'prepare' not in output['noPreparePolicy'].values()
            assert 'defend' not in output['noDefendPolicy'].values()
            assert all(c['maxUpperLowerGap'] < 1e-10 for c in output['convergence'].values())
    for profile in PROFILES:
        stats = {f"{s['agility']}_{s['composure']}": s for s in report['scenarios'] if s['profile'] == profile and s['playerHealth'] == 10 and s['startingEnergy'] == 3}
        for name in ['attack', 'defendOnTell', 'bankDefense', 'optimalWithoutPrepare']:
            assert abs(stats['3_4']['rates'][name]-stats['3_3']['rates'][name]) < 1e-10
    for scenario in report['scenarios']:
        rates = scenario['rates']
        assert all(0 <= v <= 1 for v in rates.values())
        assert rates['optimal'] + 1e-10 >= max(rates.values())
    report['verification'] = {'snapshotHashAndSourceFields': 'passed', 'transitionProbabilityNormalization': 'passed for every legal state/action in 18 models', 'globalLowerUpperConvergence': 'passed for all 180 solves', 'composureDoesNotAffectNonPrepareStrategies': 'passed', 'optimalDominatesComparedStrategies': 'passed', 'exportedPolicyLegalityAndActionRestrictions': 'passed'}
    report['runtimeSeconds'] = time.monotonic()-started
    destination = ROOT / 'four-hp-balance-exact.json'
    destination.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps([s for s in report['scenarios'] if s['playerHealth'] == 10 and s['startingEnergy'] == 3 and s['agility'] == s['composure'] == 3], indent=2))


if __name__ == '__main__':
    main()
