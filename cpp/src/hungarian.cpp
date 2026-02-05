/**
 * Hungarian Algorithm Implementation
 * 
 * Based on mcximing/hungarian-algorithm-cpp (BSD-2-Clause license).
 * Original implementation by Markus Buehren.
 * 
 * Modified for C++17 and our specific use case.
 */

#include "hungarian.hpp"

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstring>

double HungarianAlgorithm::solve(const std::vector<std::vector<double>>& cost_matrix,
                                  std::vector<int>& assignment) {
    int n_rows = static_cast<int>(cost_matrix.size());
    if (n_rows == 0) {
        assignment.clear();
        return 0.0;
    }
    
    int n_cols = static_cast<int>(cost_matrix[0].size());
    if (n_cols == 0) {
        assignment.assign(n_rows, -1);
        return 0.0;
    }
    
    // Flatten cost matrix to 1D array (column-major for algorithm)
    std::vector<double> dist_matrix(n_rows * n_cols);
    for (int i = 0; i < n_rows; ++i) {
        for (int j = 0; j < n_cols; ++j) {
            dist_matrix[i + n_rows * j] = cost_matrix[i][j];
        }
    }
    
    // Allocate assignment array
    std::vector<int> assign_arr(n_rows);
    double cost = 0.0;
    
    // Solve
    assignmentOptimal(assign_arr.data(), &cost, dist_matrix.data(), n_rows, n_cols);
    
    // Copy result
    assignment = std::move(assign_arr);
    
    return cost;
}

void HungarianAlgorithm::assignmentOptimal(int* assignment, double* cost,
                                            double* dist_matrix,
                                            int n_of_rows, int n_of_cols) {
    // Allocate working arrays (using char instead of bool for data() access)
    int n_of_elements = n_of_rows * n_of_cols;
    int min_dim = std::min(n_of_rows, n_of_cols);
    
    std::vector<char> covered_cols_v(n_of_cols, 0);
    std::vector<char> covered_rows_v(n_of_rows, 0);
    std::vector<char> star_matrix_v(n_of_elements, 0);
    std::vector<char> prime_matrix_v(n_of_elements, 0);
    std::vector<char> new_star_matrix_v(n_of_elements, 0);
    
    // Convert to bool pointers for internal use
    bool* covered_cols = reinterpret_cast<bool*>(covered_cols_v.data());
    bool* covered_rows = reinterpret_cast<bool*>(covered_rows_v.data());
    bool* star_matrix = reinterpret_cast<bool*>(star_matrix_v.data());
    bool* prime_matrix = reinterpret_cast<bool*>(prime_matrix_v.data());
    bool* new_star_matrix = reinterpret_cast<bool*>(new_star_matrix_v.data());
    
    // Preliminary steps
    if (n_of_rows <= n_of_cols) {
        // Row reduction
        for (int row = 0; row < n_of_rows; ++row) {
            // Find minimum in row
            double min_val = dist_matrix[row];
            for (int col = 1; col < n_of_cols; ++col) {
                double val = dist_matrix[row + n_of_rows * col];
                if (val < min_val) {
                    min_val = val;
                }
            }
            
            // Subtract minimum from row
            for (int col = 0; col < n_of_cols; ++col) {
                dist_matrix[row + n_of_rows * col] -= min_val;
            }
        }
        
        // Star zeros
        for (int row = 0; row < n_of_rows; ++row) {
            for (int col = 0; col < n_of_cols; ++col) {
                if (std::abs(dist_matrix[row + n_of_rows * col]) < DBL_EPSILON) {
                    if (!covered_cols[col]) {
                        star_matrix[row + n_of_rows * col] = true;
                        covered_cols[col] = true;
                        break;
                    }
                }
            }
        }
    } else {
        // Column reduction
        for (int col = 0; col < n_of_cols; ++col) {
            // Find minimum in column
            double min_val = dist_matrix[n_of_rows * col];
            for (int row = 1; row < n_of_rows; ++row) {
                double val = dist_matrix[row + n_of_rows * col];
                if (val < min_val) {
                    min_val = val;
                }
            }
            
            // Subtract minimum from column
            for (int row = 0; row < n_of_rows; ++row) {
                dist_matrix[row + n_of_rows * col] -= min_val;
            }
        }
        
        // Star zeros
        for (int col = 0; col < n_of_cols; ++col) {
            for (int row = 0; row < n_of_rows; ++row) {
                if (std::abs(dist_matrix[row + n_of_rows * col]) < DBL_EPSILON) {
                    if (!covered_rows[row]) {
                        star_matrix[row + n_of_rows * col] = true;
                        covered_cols[col] = true;
                        covered_rows[row] = true;
                        break;
                    }
                }
            }
        }
        
        // Reset row covers
        std::fill(covered_rows, covered_rows + n_of_rows, false);
    }
    
    // Move to step 2b
    step2b(assignment, dist_matrix, star_matrix, new_star_matrix,
           prime_matrix, covered_cols, covered_rows,
           n_of_rows, n_of_cols, min_dim);
    
    // Compute assignment cost
    computeAssignmentCost(assignment, cost, dist_matrix, n_of_rows);
}

void HungarianAlgorithm::buildAssignmentVector(int* assignment, bool* star_matrix,
                                                int n_of_rows, int n_of_cols) {
    for (int row = 0; row < n_of_rows; ++row) {
        for (int col = 0; col < n_of_cols; ++col) {
            if (star_matrix[row + n_of_rows * col]) {
                assignment[row] = col;
                break;
            }
        }
    }
}

void HungarianAlgorithm::computeAssignmentCost(int* assignment, double* cost,
                                                double* dist_matrix, int n_of_rows) {
    *cost = 0.0;
    for (int row = 0; row < n_of_rows; ++row) {
        int col = assignment[row];
        if (col >= 0) {
            *cost += dist_matrix[row + n_of_rows * col];
        }
    }
}

void HungarianAlgorithm::step2a(int* assignment, double* dist_matrix,
                                 bool* star_matrix, bool* new_star_matrix,
                                 bool* prime_matrix, bool* covered_cols,
                                 bool* covered_rows, int n_of_rows, int n_of_cols,
                                 int min_dim) {
    // Cover each column containing a starred zero
    for (int col = 0; col < n_of_cols; ++col) {
        for (int row = 0; row < n_of_rows; ++row) {
            if (star_matrix[row + n_of_rows * col]) {
                covered_cols[col] = true;
                break;
            }
        }
    }
    
    // Move to step 2b
    step2b(assignment, dist_matrix, star_matrix, new_star_matrix, prime_matrix,
           covered_cols, covered_rows, n_of_rows, n_of_cols, min_dim);
}

void HungarianAlgorithm::step2b(int* assignment, double* dist_matrix,
                                 bool* star_matrix, bool* new_star_matrix,
                                 bool* prime_matrix, bool* covered_cols,
                                 bool* covered_rows, int n_of_rows, int n_of_cols,
                                 int min_dim) {
    // Count covered columns
    int n_covered_cols = 0;
    for (int col = 0; col < n_of_cols; ++col) {
        if (covered_cols[col]) {
            ++n_covered_cols;
        }
    }
    
    if (n_covered_cols == min_dim) {
        // Done - build assignment
        std::fill(assignment, assignment + n_of_rows, -1);
        buildAssignmentVector(assignment, star_matrix, n_of_rows, n_of_cols);
    } else {
        // Move to step 3
        step3(assignment, dist_matrix, star_matrix, new_star_matrix, prime_matrix,
              covered_cols, covered_rows, n_of_rows, n_of_cols, min_dim);
    }
}

void HungarianAlgorithm::step3(int* assignment, double* dist_matrix,
                                bool* star_matrix, bool* new_star_matrix,
                                bool* prime_matrix, bool* covered_cols,
                                bool* covered_rows, int n_of_rows, int n_of_cols,
                                int min_dim) {
    bool zeros_found = true;
    
    while (zeros_found) {
        zeros_found = false;
        
        for (int col = 0; col < n_of_cols; ++col) {
            if (!covered_cols[col]) {
                for (int row = 0; row < n_of_rows; ++row) {
                    if (!covered_rows[row]) {
                        if (std::abs(dist_matrix[row + n_of_rows * col]) < DBL_EPSILON) {
                            // Prime zero
                            prime_matrix[row + n_of_rows * col] = true;
                            
                            // Find star in same row
                            int star_col = -1;
                            for (int c = 0; c < n_of_cols; ++c) {
                                if (star_matrix[row + n_of_rows * c]) {
                                    star_col = c;
                                    break;
                                }
                            }
                            
                            if (star_col >= 0) {
                                // Cover row, uncover star column
                                covered_rows[row] = true;
                                covered_cols[star_col] = false;
                                zeros_found = true;
                                break;
                            } else {
                                // No star in row - move to step 4
                                step4(assignment, dist_matrix, star_matrix,
                                      new_star_matrix, prime_matrix, covered_cols,
                                      covered_rows, n_of_rows, n_of_cols, min_dim,
                                      row, col);
                                return;
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Move to step 5
    step5(assignment, dist_matrix, star_matrix, new_star_matrix, prime_matrix,
          covered_cols, covered_rows, n_of_rows, n_of_cols, min_dim);
}

void HungarianAlgorithm::step4(int* assignment, double* dist_matrix,
                                bool* star_matrix, bool* new_star_matrix,
                                bool* prime_matrix, bool* covered_cols,
                                bool* covered_rows, int n_of_rows, int n_of_cols,
                                int min_dim, int row, int col) {
    int n_of_elements = n_of_rows * n_of_cols;
    
    // Generate temporary copy of star_matrix
    std::memcpy(new_star_matrix, star_matrix, n_of_elements * sizeof(bool));
    
    // Star the primed zero
    new_star_matrix[row + n_of_rows * col] = true;
    
    // Find star in column
    int star_row = -1;
    for (int r = 0; r < n_of_rows; ++r) {
        if (star_matrix[r + n_of_rows * col]) {
            star_row = r;
            break;
        }
    }
    
    while (star_row >= 0) {
        // Unstar the starred zero
        new_star_matrix[star_row + n_of_rows * col] = false;
        
        // Find prime in row
        int prime_col = -1;
        for (int c = 0; c < n_of_cols; ++c) {
            if (prime_matrix[star_row + n_of_rows * c]) {
                prime_col = c;
                break;
            }
        }
        
        // Star the primed zero
        new_star_matrix[star_row + n_of_rows * prime_col] = true;
        
        col = prime_col;
        
        // Find star in column
        star_row = -1;
        for (int r = 0; r < n_of_rows; ++r) {
            if (star_matrix[r + n_of_rows * col]) {
                star_row = r;
                break;
            }
        }
    }
    
    // Update star_matrix
    std::memcpy(star_matrix, new_star_matrix, n_of_elements * sizeof(bool));
    
    // Reset covers and primes
    std::fill(prime_matrix, prime_matrix + n_of_elements, false);
    std::fill(covered_rows, covered_rows + n_of_rows, false);
    
    // Step 2a
    step2a(assignment, dist_matrix, star_matrix, new_star_matrix, prime_matrix,
           covered_cols, covered_rows, n_of_rows, n_of_cols, min_dim);
}

void HungarianAlgorithm::step5(int* assignment, double* dist_matrix,
                                bool* star_matrix, bool* new_star_matrix,
                                bool* prime_matrix, bool* covered_cols,
                                bool* covered_rows, int n_of_rows, int n_of_cols,
                                int min_dim) {
    // Find smallest uncovered value
    double min_val = DBL_MAX;
    for (int row = 0; row < n_of_rows; ++row) {
        if (!covered_rows[row]) {
            for (int col = 0; col < n_of_cols; ++col) {
                if (!covered_cols[col]) {
                    double val = dist_matrix[row + n_of_rows * col];
                    if (val < min_val) {
                        min_val = val;
                    }
                }
            }
        }
    }
    
    // Add to covered rows, subtract from uncovered columns
    for (int row = 0; row < n_of_rows; ++row) {
        if (covered_rows[row]) {
            for (int col = 0; col < n_of_cols; ++col) {
                dist_matrix[row + n_of_rows * col] += min_val;
            }
        }
    }
    
    for (int col = 0; col < n_of_cols; ++col) {
        if (!covered_cols[col]) {
            for (int row = 0; row < n_of_rows; ++row) {
                dist_matrix[row + n_of_rows * col] -= min_val;
            }
        }
    }
    
    // Move to step 3
    step3(assignment, dist_matrix, star_matrix, new_star_matrix, prime_matrix,
          covered_cols, covered_rows, n_of_rows, n_of_cols, min_dim);
}
