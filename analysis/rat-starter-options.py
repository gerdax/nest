"""Model-only first-encounter tuning, with HP/Energy capped at 10."""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('rat_defense_options', Path(__file__).with_name('rat-defense-options.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
DefenseModel = module.DefenseModel
fixed_policy = module.fixed_policy

if __name__ == '__main__':
    result = {'scope': 'Model only; player HP10, Energy cap10, rat HP6. Rat defense rolled except guaranteedBoth. Existing timing unchanged.',
              'variants': {}}
    for mode, bite, charge in [('rolled', 1, 2), ('guaranteed', 1, 2),
                               ('rolled', 2, 3), ('guaranteed', 2, 3),
                               ('guaranteed', 1, 3), ('guaranteedBoth', 2, 3)]:
        row = {}
        for name in ['optimal', 'attack', 'prepareOnTell', 'defendOnTell', 'random']:
            model = DefenseModel('guaranteed' if mode == 'guaranteedBoth' else mode,
                enemy_block=1. if mode == 'guaranteedBoth' else module.Q,
                bite_damage=bite, charge_damage=charge, max_energy=10).solve(
                None if name == 'optimal' else 'random' if name == 'random' else fixed_policy(name))
            row[name] = {e: model.enemy(10, 6, e, 0, 0) for e in [3, 10]}
        result['variants'][f'{mode}_bite{bite}_charge{charge}'] = row
    Path(__file__).with_name('rat-starter-options-results.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))
