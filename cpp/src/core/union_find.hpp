#pragma once

#include <unordered_map>

class UnionFind {
public:
    void reset() { parent_.clear(); }

    void add(int x) { parent_[x] = x; }

    int find(int x) {
        auto it = parent_.find(x);
        if (it == parent_.end()) {
            parent_[x] = x;
            return x;
        }
        const int p = it->second;
        if (p == x) return x;
        const int r = find(p);
        parent_[x] = r;
        return r;
    }

    void unite(int a, int b) {
        const int ra = find(a);
        const int rb = find(b);
        if (ra == rb) return;
        if (ra < rb) parent_[rb] = ra;
        else parent_[ra] = rb;
    }

private:
    std::unordered_map<int, int> parent_;
};
