"""Counterfactual defense rules for the 6-Health rat; model only.

Run: python3 analysis/rat-defense-options.py
The rat keeps its existing rolled full-block defense except in the explicitly
named guaranteedBlockBoth option. Player defense still
costs an action and Energy up front and is consumed by misses / rat block.
"""
import json
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('rat_health_comparison', Path(__file__).with_name('rat-health-comparison.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
Model, Q, fixed_policy = base.Model, base.Q, base.fixed_policy


class DefenseModel(Model):
    def __init__(self, mode='rolled', cost=1, enemy_block=Q, bite_damage=2, charge_damage=4, max_energy=3):
        super().__init__(enemy_block=enemy_block, bite_damage=bite_damage, charge_damage=charge_damage, max_energy=max_energy)
        self.mode, self.cost = mode, cost

    def choices(self, state):
        return ['attack', 'prepare'] + (['defend'] if state[2] >= self.cost else [])

    def incoming(self, guard, damage):
        if not guard:
            return [(0, 1-Q), (damage, Q)]
        if self.mode == 'guaranteed':
            return [(0, 1.)]
        if self.mode == 'reduce2':
            return [(0, 1-Q), (max(0, damage-2), Q)]
        if self.mode == 'failReduce2':
            return [(0, 1-Q+Q*Q), (max(0, damage-2), Q*(1-Q))]
        return super().incoming(guard, damage)

    def action(self, state, action):
        # Base action pays one Energy; shift before it to pay the chosen cost.
        if action == 'defend':
            h, r, e, p, g, cue = state
            state = (h, r, e-self.cost+1, p, g, cue)
        return super().action(state, action)


if __name__ == '__main__':
    report = {'scope': 'Counterfactual player defense; rat unchanged except guaranteedBlockBoth. Fair IID dice. Player HP10, rat HP6.',
              'objective': 'Maximize probability of winning this encounter; remaining Health/Energy has no terminal reward.',
              'options': {}}
    for name, mode, cost, enemy_block in [('current', 'rolled', 1, Q), ('guaranteedBlock', 'guaranteed', 1, Q),
                             ('guaranteedBlockCost2', 'guaranteed', 2, Q),
                             ('guaranteedReduction2', 'reduce2', 1, Q),
                             ('rolledBlockFailReduction2', 'failReduce2', 1, Q),
                             ('guaranteedBlockBoth', 'guaranteed', 1, 1.)]:
        model = DefenseModel(mode, cost, enemy_block, max_energy=10).solve()
        rates = {e: model.enemy(10, 6, e, 0, 0) for e in [0, 1, 2, 3, 5, 10]}
        cases = []
        for state in [(10, 6, 3, 0, 0, 'prepare'), (4, 4, 3, 0, 0, 'prepare'), (2, 2, 3, 0, 0, 'prepare')]:
            cases.append({'state': state, 'continuationWinByAction':
                          {a: model.action(state, a) for a in model.choices(state)}})
        # A fixed frequent-defense strategy must respect the variant's cost.
        policy = lambda s, cost=cost: 'defend' if s[5] == 'prepare' and s[2] >= cost else 'attack'
        frequent = DefenseModel(mode, cost, enemy_block, max_energy=10).solve(policy)
        report['options'][name] = {'cost': cost, 'enemyBlockChance': enemy_block, 'optimalByStartingEnergy': rates,
                                  'frequentDefenseWin': {e: frequent.enemy(10, 6, e, 0, 0) for e in [3, 10]}, 'situations': cases}
    destination = Path(__file__).with_name('rat-defense-options-results.json')
    destination.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({n: {k: v for k, v in r.items() if k != 'situations'}
                      for n, r in report['options'].items()}, indent=2))
