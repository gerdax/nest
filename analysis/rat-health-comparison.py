"""Compare 6/8-Health rats and isolate Defend's contribution to survival.

Independent fair-dice model of the opposed-preparation coordinator. No engine
or project writes. Run: python3 analysis/rat-health-comparison.py
"""
import itertools
import json
from pathlib import Path

Q = 0.625
STATES = list(itertools.product(range(2, 11, 2), range(2, 9, 2),
                               range(4), [0, 1], [0, 1], ['clear', 'prepare']))


class Model:
    def __init__(self, defend=True, enemy_block=Q, bite_damage=2, charge_damage=4, max_energy=3):
        self.defend = defend
        self.enemy_block = enemy_block
        self.bite_damage, self.charge_damage = bite_damage, charge_damage
        even_health = bite_damage % 2 == 0 and charge_damage % 2 == 0
        self.states = list(itertools.product(range(2, 11, 2) if even_health else range(1, 11),
                         range(2, 9, 2), range(max_energy+1), [0, 1], [0, 1], ['clear', 'prepare']))
        self.values = dict.fromkeys(self.states, 0.)

    def choices(self, state):
        return ['attack', 'prepare'] + (['defend'] if self.defend and state[2] else [])

    def value(self, h, r, e, p, g, cue):
        return 1. if r <= 0 else 0. if h <= 0 else self.values[h, r, e, p, g, cue]

    @staticmethod
    def incoming(guard, damage):
        hurt = Q * (1-Q if guard else 1)
        return [(0, 1-hurt), (damage, hurt)]

    def enemy(self, h, r, e, p, g):
        # Bite resolves before clear choices; hidden Prepare activates first.
        return .5 * sum(w*self.value(h-d, r, e, p, 0, 'clear')
                        for d, w in self.incoming(g, self.bite_damage)) + .5*self.value(h, r, e, p, g, 'prepare')

    def action(self, state, action):
        h, r, e, p, g, cue = state
        if action == 'defend':
            e -= 1
            g = 1
        if action == 'prepare':
            p = 1

        def branch(block):
            chance = Q*(1-self.enemy_block if block else 1) if action == 'attack' else 0
            prepared = 0 if action == 'attack' else p
            total = 0.
            for hit, weight in [(1, chance), (0, 1-chance)]:
                rat = r - (2+2*p)*hit
                if rat <= 0:
                    value = 1.  # Lethal attack cancels charge.
                elif cue == 'clear' or block:
                    value = self.enemy(h, rat, e, prepared, 0 if block else g)
                else:
                    value = sum(w*self.value(h-d, rat, e, prepared, 0, 'clear')
                                for d, w in self.incoming(g, self.charge_damage))
                total += weight*value
            return total

        return branch(False) if cue == 'clear' else .5*branch(True)+.5*branch(False)

    def solve(self, fixed=None):
        def update(state):
            if fixed is None:
                return max(self.action(state, a) for a in self.choices(state))
            if fixed == 'random':
                choices = self.choices(state)
                return sum(self.action(state, a) for a in choices)/len(choices)
            return self.action(state, fixed(state))

        def iterate():
            for _ in range(1000):
                delta = 0.
                for state in self.states:
                    value = update(state)
                    delta = max(delta, abs(self.values[state]-value))
                    self.values[state] = value
                if delta < 1e-13:
                    return
            raise AssertionError('Value iteration failed to converge')

        iterate()
        lower = self.values.copy()
        self.values = dict.fromkeys(self.states, 1.)
        iterate()
        assert max(abs(self.values[s]-lower[s]) for s in self.states) < 1e-10
        self.values = lower
        return self

    def policy(self):
        return {','.join(map(str, s)): max(self.choices(s), key=lambda a: self.action(s, a))
                for s in self.states}


def fixed_policy(name):
    def choose(state):
        h, r, e, p, g, cue = state
        tell = cue == 'prepare'
        if name == 'alternate' and not p and r > 2:
            return 'prepare'
        if name == 'prepareOnTell' and tell and not p and r > 2:
            return 'prepare'
        if name == 'defendOnTell' and tell and e:
            return 'defend'
        if name == 'bankDefense' and cue == 'clear' and not g and e:
            return 'defend'
        if name == 'cautious':
            if tell and r > 2 and not g and e:
                return 'defend'
            if tell and not p and r > 2:
                return 'prepare'
        return 'attack'
    return choose


if __name__ == '__main__':
    optimal = Model().solve()
    no_defend = Model(defend=False).solve()
    names = ['attack', 'alternate', 'prepareOnTell', 'defendOnTell', 'bankDefense', 'cautious', 'random']
    models = {n: Model().solve('random' if n == 'random' else fixed_policy(n)) for n in names}
    report = {'assumptions': 'Player Health 10, Energy 3; fair IID dice; existing opposed-preparation timing.',
              'byRatHealth': {}, 'optimalPolicy': optimal.policy(), 'noDefendPolicy': no_defend.policy(),
              'situations': []}
    for rat in [8, 6]:
        rates = {n: m.enemy(10, rat, 3, 0, 0) for n, m in models.items()}
        rates.update(optimal=optimal.enemy(10, rat, 3, 0, 0),
                     optimalWithoutDefend=no_defend.enemy(10, rat, 3, 0, 0))
        report['byRatHealth'][rat] = rates
    for state in [(10, 6, 3, 0, 0, 'clear'), (10, 6, 3, 0, 0, 'prepare'),
                  (4, 4, 3, 0, 0, 'prepare'), (2, 6, 3, 1, 0, 'prepare'),
                  (2, 2, 3, 0, 0, 'prepare')]:
        report['situations'].append({'state': state, 'continuationWinByAction':
                                    {a: optimal.action(state, a) for a in optimal.choices(state)}})
    destination = Path(__file__).with_name('rat-health-comparison-exact.json')
    destination.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k: v for k, v in report.items() if not k.endswith('Policy')}, indent=2))
