---
title: Building a Fertilizer Calculator with AI - Sonnet vs Codex
tags: [Reverse Engineering, String Obfuscation]
style: border
color: light
description: How Applications Hide Exception Strings from Reverse Engineers — and How Those Strings Get Recovered Anyway
---

# How Applications Hide Exception Strings from Reverse Engineers — and How Those Strings Get Recovered Anyway

Error messages are one of the most useful things a reverse engineer can read in a binary. An exception string like `"license signature mismatch"` or `"rate limit exceeded for tier: internal"` tells you exactly where a security check, a licensing gate, or an internal-only code path lives — often faster than tracing control flow ever would. Because of that, string literals are one of the first things a protection scheme tries to hide, and one of the first things a reverse engineer learns to recover anyway.

This post walks through *why* string constants leak so much information, the standard techniques used to obscure them, and the general workflow reverse engineers use to defeat those techniques — independent of any specific vendor or product.

## Why plain string constants are a problem for defenders

Compiled code — JVM bytecode, .NET IL, native binaries — stores string literals essentially as plaintext in a constant pool or data section. Static analysis tools (disassemblers, decompilers, or even a blunt `strings` pass) can dump every literal in a binary in seconds. If your licensing check throws `new LicenseExpiredException("license expired")`, an attacker doesn't need to understand your code at all — they grep for `"expired"`, land directly on the check, and patch around it.

This makes string constants a disproportionately valuable target relative to the effort needed to extract them, which is why they're one of the first things commercial and anti-tamper-conscious software obfuscates — often before control-flow obfuscation, identifier renaming, or anti-debugging measures are even applied.

## Common string-hiding techniques

These range from trivial to fairly sophisticated. In roughly increasing order of effort:

**1. Simple encoding (not encryption).** Base64, ROT13, or byte-XOR against a fixed constant. Cheap to implement, cheap to break — a single fixed key or transform is found once and applies to every string in the binary.

**2. Per-string keyed encryption.** Each string is encrypted with its own key or IV, often derived from a value embedded alongside the ciphertext. A common pattern in JVM/.NET bytecode: the string is stored as an array of integers/longs, and at the call site, a small decoder object is constructed from that array and its `.toString()` (or equivalent) performs the decryption inline. A frequently seen construction is:

```
seed = payload[0]
prng = new SeededRandom(seed)
for each remaining chunk in payload:
    plaintext_bytes += chunk XOR prng.next()
result = decode_utf8(plaintext_bytes)
```

This is attractive to obfuscation tool authors because it's cheap at runtime (a PRNG and XOR, no real cryptography), doesn't require a shared key stored anywhere in the binary, and produces a different-looking payload for every string even when the plaintext repeats, since the seed differs per call site.

In disassembly, a call site using this pattern tends to look roughly like this (names anonymized — the actual identifiers in a real obfuscated binary are usually meaningless single letters or non-printable characters):

```
// decompiled/disassembled call site
throw new SomeCheckedException(
    new StrPayload(new long[]{
        4611574839349102L, -889271004473552810L,
        7720485251280135261L, -2818613486440111438L
    }).toString()
);

// inside StrPayload's constructor (pseudocode, reconstructed by hand)
StrPayload(long[] payload) {
    long seed = payload[0];
    Lcg rng = new Lcg(seed);          // some 48-bit linear congruential generator
    byte[] out = new byte[8 * (payload.length - 1)];
    for (int i = 1; i < payload.length; i++) {
        long word = payload[i] ^ rng.nextLong();
        writeLittleEndian(out, (i - 1) * 8, word);
    }
    this.value = truncateAtFirstNul(new String(out, "UTF-8"));
}
```

The exact shape varies by obfuscator (some use ints instead of longs, some derive the key from a hash of the method name instead of a literal seed, some XOR against a repeating block cipher instead of a PRNG stream) but the skeleton — *seed, keystream, XOR, decode* — is extremely common because it's cheap and requires no shared secret.

**3. String pooling with a single runtime decryptor.** Instead of every string being self-contained, all encrypted strings live in one table (often loaded from a resource or embedded blob) and a single method decrypts by index at first access, sometimes caching the result. This centralizes the algorithm in one place — good for the obfuscator's tooling, but also gives a reverse engineer one place to focus on.

**4. Native/compiled decryption routines.** Instead of implementing the decrypt logic in the same bytecode/IL as the rest of the app, it's pushed into a native library (JNI, P/Invoke) or a packed/virtualized code region, so static bytecode analysis can't even see the algorithm — only the call into an opaque native function.

**5. Control-flow and identifier obfuscation layered on top.** String encryption is rarely used alone. It's typically combined with identifier renaming (methods/classes given meaningless or non-printable names), control-flow flattening, and dead-code insertion, so that even after strings are recovered, understanding *where* they're used and *why* still takes real analysis effort.

**6. Anti-tamper / anti-debug guards around the decryptor.** More aggressive schemes detect debuggers or hooking frameworks and refuse to decrypt (or actively return garbage) when they suspect they're being analyzed, forcing the analyst to first defeat the detection before the string recovery even starts.

None of these make string recovery impossible — cryptographically that would require a real per-deployment secret that isn't shippable inside the binary, which defeats the purpose of shipping a decryptable string at all. What they buy the defender is *cost*: enough friction that casual `strings`/grep scavenging fails, and dedicated reverse engineering becomes a debugger session or a scripting exercise, and dedicated is far more expensive than casual.

## How reverse engineers recover the strings anyway

The fundamental asymmetry that reverse engineers exploit: **whatever algorithm the app uses to decrypt a string at runtime must be present in the app itself.** There is no way to ship code that can decrypt something without also shipping the ability to decrypt it — so the "secret" is always somewhere in the binary, just not laid out as plainly as a string literal. Recovery is a matter of finding and replaying that algorithm rather than "breaking" a cryptosystem. There are three general approaches, roughly in order of effort and reliability:

### 1. Static replay — extract the algorithm, reimplement it, batch-decrypt

This is the highest-effort but most scalable approach, and the one worth investing in when you need to search *every* string in an application rather than inspect one at a time.

- Locate the decryption routine (usually easy — it's the one function referenced from every encrypted-string call site, so it shows up with an unusually high number of cross-references).
- Disassemble or decompile *just that routine* and work out its algorithm by hand. This is normal reverse engineering: read the bytecode/IL/assembly instruction by instruction, and note what transform is applied to the input bytes.
- Reimplement the algorithm faithfully in a scripting language (Python is the common choice) — replicating any PRNG, block cipher, or bit-manipulation exactly, since off-by-one errors in shift amounts, byte order, or seed derivation cause complete garbage output rather than a partial match.
- Write a second script that scans the entire binary/bytecode for the encrypted-string *pattern* (e.g. "an array literal of N integers immediately passed to the known decryptor constructor"), extracts every payload, and feeds each one through the reimplemented algorithm.
- The result is a searchable, offline database of every string in the application — recovered without ever running it.

This is exactly the technique behind tools like Android's `dex-oracle`, `simplify`, or custom deobfuscation scripts built for a specific obfuscator: identify the transform once, then apply it everywhere, entirely statically.

Concretely, once the pseudocode above has been reconstructed, the reimplementation in a scripting language is usually short — most of the effort was in reading the disassembly, not in the port itself:

```python
MASK64 = (1 << 64) - 1

class Lcg:
    """Generic 48-bit linear congruential generator, matching whatever
    constants the target obfuscator's PRNG uses."""
    def __init__(self, seed, mult, add):
        self.state = (seed ^ mult) & ((1 << 48) - 1)
        self.mult, self.add = mult, add

    def next_long(self):
        hi = self._next(32)
        lo = self._next(32)
        return ((hi << 32) + lo) & MASK64

    def _next(self, bits):
        self.state = (self.state * self.mult + self.add) & ((1 << 48) - 1)
        return self.state >> (48 - bits)

def decode(payload, mult, add):
    rng = Lcg(payload[0], mult, add)
    out = bytearray()
    for word in payload[1:]:
        keyed = (word & MASK64) ^ rng.next_long()
        out += keyed.to_bytes(8, "little")
    text = out.decode("utf-8", errors="replace")
    return text[: text.find("\x00")] if "\x00" in text else text
```

And the batch scanner that drives it is a straightforward pattern match over the disassembly of every class/module: find the array-literal-into-known-constructor shape, collect the payload, decode, repeat.

```python
# pseudocode — walk disassembly, find "long[]{...}" literals immediately
# passed to the known decryptor constructor, decode each one
for file in all_compiled_files(root):
    for array_literal, constructor_call in find_payload_sites(file, decryptor_signature):
        payload = parse_long_array(array_literal)
        print(file, decode(payload, KNOWN_MULT, KNOWN_ADD))
```

Run across an entire application tree, this turns a "handful of strings I noticed while debugging" into a complete, searchable table of every encrypted literal in the binary — recovered offline, without running the target at all.

### 2. Dynamic extraction — let the app decrypt itself, and just watch

When the algorithm is hard to reconstruct by hand (native code, a heavier cipher, control-flow obfuscation making the routine hard to read) it's often far cheaper to let the program do the work and observe the result, rather than reverse-engineer the math:

- **Runtime hooking / instrumentation** (Frida, function interception, JVM/CLR profiling agents): attach a hook to the decryption function itself, and log every `(input, output)` pair as the app runs normally. You now have plaintext for every string the app actually decrypts during that run, without knowing anything about the algorithm.
- **Reflection / direct invocation**: if the decrypt routine is a normal method in a managed runtime (JVM, .NET, Python bytecode), you can often load the class and call the method directly via reflection with payloads extracted statically — using the application's *own* code as the decryption oracle instead of reimplementing it. This is a hybrid of static and dynamic approaches: static extraction of payloads, dynamic (in-process) decryption.
- **Debugger breakpoints**: set a breakpoint at the end of the decrypt routine and single-step or dump memory to read the plaintext right before it's used or discarded.

The dynamic approach trades completeness for effort — you only recover strings actually exercised during your session (or reachable via reflection) — but sidesteps needing to fully understand the cryptographic details, and works even when the routine is deliberately hard to read statically.

### 3. Memory / heap scavenging

If the string is decrypted once and cached (common for performance), it exists in cleartext in process memory for the process's lifetime. A memory dump or a live heap walk of a running instance will surface every decrypted string that's ever been touched, regardless of how it was originally encoded. This is the crudest approach but also the hardest to defend against — the plaintext *must* exist in memory at the moment it's used (thrown, logged, displayed), so this is the technique's ultimate floor: any protection scheme is only ever raising the cost of static analysis, never eliminating the runtime plaintext.

## The practical takeaway

For defenders: string encryption meaningfully raises the bar against casual scavenging (`strings`, grep, quick decompiles) and against automated scrapers, but it does not stop a motivated analyst — the algorithm ships with the app by necessity, and once it's understood once, it's broken everywhere it's used. The real value of string encryption is usually as one layer in a broader obfuscation strategy (combined with identifier renaming, control-flow obfuscation, and anti-tamper checks) rather than a standalone defense — each additional layer increases the *cost* of static analysis, which is the only lever available once the runtime plaintext requirement is accepted as unavoidable.

For analysts: the general workflow is always the same regardless of the specific obfuscator — find the decryption routine (it's the one thing with unusually many cross-references), decide whether it's cheaper to reimplement statically or to instrument dynamically, and then automate the recovery across the whole binary rather than decoding call sites by hand one at a time.
