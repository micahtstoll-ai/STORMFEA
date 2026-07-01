# STORMFEA July Challenge Log

## Open Risks — Must Close Before September 12 Public Release

### C3D10_REORDER Permutation — Unverified Against TetGen Binary

**Status:** Open  
**Added:** 2026-07-01  
**Affects:** STL file meshing only (STEP files use Gmsh, which is unaffected)  
**Does not affect:** Any STEP-based geometry or Gmsh-meshed results  

**What it is:**  
The `C3D10_REORDER` permutation in `server/tetgen.ts` (lines 136, 140, 167, 206) maps TetGen's midnode ordering to STORMFEA's internal convention. This permutation was derived from TetGen documentation but has never been verified against actual TetGen binary output. If the permutation is wrong, C3D10 results for STL-meshed geometry are silently incorrect. The test suite cannot catch this because the tests were written against the same permutation.

**How to close it:**  
1. Install TetGen locally per the README  
2. Run TetGen on a known simple geometry (a cube or sphere STL is sufficient) with the `-o2` flag to generate quadratic elements  
3. Read the output `.ele` file and confirm the midnode ordering at indices 4–9 matches what `C3D10_REORDER = [0, 1, 2, 3, 4, 7, 5, 6, 8, 9]` assumes  
4. If it matches: delete this entry and add a note to the PR #57 description confirming empirical verification  
5. If it does not match: open a new issue with the correct permutation before merging any STL/C3D10 analysis path to production  

**Owner:** Micah (requires local TetGen install — cannot be verified in the Claude Code sandbox)
