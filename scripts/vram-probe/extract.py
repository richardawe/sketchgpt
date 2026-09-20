import json, pathlib, sys

def extract(path):
    b = pathlib.Path(path).read_bytes()
    i = b.find(b'{"model_type"')
    if i < 0:
        i = b.rfind(b'{"quantization"')
    if i < 0:
        # find start by walking back from kv_state_kind to nearest '{"'
        k = b.find(b'kv_state_kind')
        i = b.rfind(b'{"', 0, k)
    # brace-match forward
    depth, j, instr, esc = 0, i, False, False
    while j < len(b):
        c = b[j:j+1]
        if instr:
            if esc: esc = False
            elif c == b'\\': esc = True
            elif c == b'"': instr = False
        else:
            if c == b'"': instr = True
            elif c == b'{': depth += 1
            elif c == b'}':
                depth -= 1
                if depth == 0:
                    j += 1
                    break
        j += 1
    return json.loads(b[i:j].decode('utf-8'))

DT = {"uint32":4,"float16":2,"float32":4,"int32":4,"uint8":1,"int8":1,"bfloat16":2,"int64":8,"uint16":2}

for path in sys.argv[1:]:
    m = extract(path)
    pb = 0
    for p in m["params"]:
        n = 1
        for d in p["shape"]: n *= d
        pb += n * DT[p["dtype"]]
    kv = m.get("kv_cache") or {}
    mu = m.get("memory_usage") or {}
    name = pathlib.Path(path).stem
    print(f"\n### {name}")
    print(f"  compiled ctx={m.get('context_window_size')} prefill_chunk={m.get('prefill_chunk_size')} "
          f"sliding={m.get('sliding_window_size')} kv_state={m.get('kv_state_kind')} max_batch={m.get('max_batch_size')}")
    print(f"  params: {pb/1e6:.1f} MB  ({len(m['params'])} tensors)")
    if kv:
        per_tok = 2*kv['num_hidden_layers']*kv['num_key_value_heads']*kv['head_dim']*2
        print(f"  kv/token: {per_tok/1024:.0f} KiB  -> @4096 {per_tok*4096/1e6:.0f} MB  @2048 {per_tok*2048/1e6:.0f} MB  @1024 {per_tok*1024/1e6:.0f} MB")
    print("  memory_usage (workspace per VM function):")
    for k, v in sorted(mu.items(), key=lambda x: -x[1]):
        if v: print(f"      {k:34} {v/1e6:9.1f} MB")
    print(f"  MAX over all functions:            {max(mu.values())/1e6:9.1f} MB")
    used = {k:v for k,v in mu.items() if not k.startswith('batch_verify')}
    print(f"  MAX excluding batch_verify:        {max(used.values())/1e6:9.1f} MB")
