#pragma once

#include <vector>

/**
 * Hungarian Algorithm (Kuhn-Munkres) for optimal assignment.
 * 
 * Solves the linear assignment problem: given an MxN cost matrix,
 * find the assignment of rows to columns that minimizes total cost.
 * 
 * Based on mcximing/hungarian-algorithm-cpp (BSD-2-Clause license).
 */
class HungarianAlgorithm {
public:
    /**
     * Solve the assignment problem.
     * 
     * @param cost_matrix MxN cost matrix where cost_matrix[i][j] is the cost
     *                    of assigning row i to column j
     * @param assignment  Output: assignment[i] = j means row i is assigned to column j
     *                    assignment[i] = -1 means row i is unassigned
     * @return Total cost of the optimal assignment
     */
    double solve(const std::vector<std::vector<double>>& cost_matrix,
                 std::vector<int>& assignment);

private:
    void assignmentOptimal(int* assignment, double* cost, double* dist_matrix,
                          int n_of_rows, int n_of_cols);
    
    void buildAssignmentVector(int* assignment, bool* star_matrix,
                               int n_of_rows, int n_of_cols);
    
    void computeAssignmentCost(int* assignment, double* cost, double* dist_matrix,
                               int n_of_rows);
    
    void step2a(int* assignment, double* dist_matrix, bool* star_matrix,
                bool* new_star_matrix, bool* prime_matrix, bool* covered_cols,
                bool* covered_rows, int n_of_rows, int n_of_cols, int min_dim);
    
    void step2b(int* assignment, double* dist_matrix, bool* star_matrix,
                bool* new_star_matrix, bool* prime_matrix, bool* covered_cols,
                bool* covered_rows, int n_of_rows, int n_of_cols, int min_dim);
    
    void step3(int* assignment, double* dist_matrix, bool* star_matrix,
               bool* new_star_matrix, bool* prime_matrix, bool* covered_cols,
               bool* covered_rows, int n_of_rows, int n_of_cols, int min_dim);
    
    void step4(int* assignment, double* dist_matrix, bool* star_matrix,
               bool* new_star_matrix, bool* prime_matrix, bool* covered_cols,
               bool* covered_rows, int n_of_rows, int n_of_cols, int min_dim,
               int row, int col);
    
    void step5(int* assignment, double* dist_matrix, bool* star_matrix,
               bool* new_star_matrix, bool* prime_matrix, bool* covered_cols,
               bool* covered_rows, int n_of_rows, int n_of_cols, int min_dim);
};
