# Kubernetes Hands‑On: Single‑Node Kind Cluster — Project Demo

Purpose  
Reproduce a local Kubernetes lab using Kind and the provided `project` app (Node.js backend + static frontend). Follow steps to create a cluster, deploy apps, expose them via Service/Ingress, add probes/limits, enable HPA, perform rollouts/rollback and run multi‑app routing (v1/v2).

Requirements (restated)
1. Create a Single‑Node Kind Cluster (https://kind.sigs.k8s.io/)  
2. Deploy a simple Node.js app (app1 / backend)  
3. Expose it: ClusterIP → NodePort/Ingress  
4. Add resource limits + liveness/readiness probes  
5. Enable autoscaling (HPA) via metrics-server  
6. Deploy new app1 image (new version)  
7. Rollback old image  
8. Single cluster, multi‑app:
   - deploy new frontend (vuejs) image and new backend image (v2)
   - service‑to‑service communication (frontend → app1)
   - Ingress routing for multiple apps (/ , /v2, /api)

Repository layout (important files)
- project/
  - backend/Dockerfile, backend/server.js (BE1)
  - backend-v2/Dockerfile, backend-v2/server.js (BE2)
  - frontend/Dockerfile, frontend/index.html (FE v1)
- k8s-resources/
  - ./backend-deployment.yaml  
  - ./backend-service.yaml  
  - ./backend-v2-deployment.yaml  
  - ./backend-v2-service.yaml
  - ./frontend-deployment.yaml  
  - ./frontend-service.yaml  
  - ./ingress.yaml  
  - ./backend-hpa.yaml  
  - ./kind-config.yaml  

  - namespace-devops.yaml
  - backend-v1-deployment-devops.yaml (Deployment + Service in namespace devops)
  - backend-v2-deployment-devops.yaml (Deployment + Service in namespace devops)
  - frontend-deployment-devops.yaml (Deployment + Service in namespace devops)
  - be1-service-devops.yaml, be2-service-devops.yaml (optional alias services)
  - ingress-devops.yaml (Ingress in namespace devops)

Prerequisites
- Docker (running)  
- kind (installed)  
- kubectl (installed and configured to use the Kind cluster)  
- PowerShell or bash (examples below use PowerShell syntax where relevant)

Quick workflow (commands — run from repo root)

1) Create Kind cluster
```powershell
kind create cluster --name k8s-learning --config ./kind-config.yaml --image kindest/node:v1.29.2
kubectl cluster-info
kubectl get nodes
```

2) Build images (backend + frontend v1 and v2)
```powershell
cd ./project

# build backend
docker build -t my-backend:v1 ./backend

# build backend-v2 image
docker build -t my-backend:v2 ./backend-v2

# build frontend v1
docker build -t my-frontend:v1 ./frontend

# create a quick frontend v2 (temporary edit or use a different Dockerfile/context)
# (example: modify index.html to show "v2" then build)
docker build -t my-frontend:v2 ./frontend
```

3) Load images into Kind (required for local images)
```powershell
kind load docker-image my-backend:v1 --name k8s-learning
kind load docker-image my-backend:v2 --name k8s-learning
kind load docker-image my-frontend:v1 --name k8s-learning
kind load docker-image my-frontend:v2 --name k8s-learning
```

4) Apply Deployments & Services
```powershell
kubectl apply -f ./backend-deployment.yaml
kubectl apply -f ./backend-service.yaml
kubectl apply -f ./backend-v2-deployment.yaml
kubectl apply -f ./backend-v2-service.yaml
kubectl apply -f ./frontend-deployment.yaml
kubectl apply -f ./frontend-service.yaml
kubectl get deploy,svc,pods -o wide
```

Test
```powershell
kubectl get po,svc,ingress -o wide
kubectl get endpoints project-backend-service project-backend-v2-service
kubectl get endpoints project-backend-service project-backend-v2-service project-frontend-service
```

If apply devops namespace:
```powershell
# Create namespace first
kubectl apply -f ./k8s-resources/namespace-devops.yaml

# Deploy resources in devops namespace
kubectl apply -f ./k8s-resources/backend-v1-deployment-devops.yaml
kubectl apply -f ./k8s-resources/backend-v2-deployment-devops.yaml
kubectl apply -f ./k8s-resources/frontend-deployment-devops.yaml
# optional alias services
kubectl apply -f ./k8s-resources/be1-service-devops.yaml
kubectl apply -f ./k8s-resources/be2-service-devops.yaml
```

5) Install Ingress Controller (nginx for Kind) and apply Ingress
```powershell
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl get pods -n ingress-nginx --watch
# once ingress-nginx pods are Ready:
kubectl apply -f ./ingress.yaml
kubectl get ingress

# if apply devops namespace
kubectl apply -f ./k8s-resources/ingress.yaml
kubectl get ingress -n devops
```

Test via host (after ingress-nginx Ready)
```powershell
curl http://localhost/api/data    # backend
curl http://localhost/api/v2      # backend-v2
curl http://localhost/api/v2/api/data # backend-v2 -> Call backend
curl http://localhost/            # frontend v1
curl http://localhost/v2          # frontend v2 (if configured)
```

If Ingress not available, debug or port‑forward:
```powershell
kubectl port-forward svc/project-backend-service 3000:80
curl http://localhost:3000/api/data

kubectl port-forward svc/project-frontend-service 8080:80
start http://localhost:8080
```

Test internal DNS / service‑to‑service (inside cluster)
- Default DNS: <service>.<namespace>.svc.cluster.local
- Example tests:
```powershell
kubectl run --rm -it curl-test --image=curlimages/curl --restart=Never -n devops -- /bin/sh -c "curl -s http://project-backend-service.devops/api/data"
# alias service test (if be1 service created)
kubectl run --rm -it curl-test --image=curlimages/curl --restart=Never -n devops -- /bin/sh -c "curl -s http://be1.devops/api/data"

# Test with FQDN
kubectl run --rm -it curl-test --image=curlimages/curl --restart=Never -n devops -- /bin/sh -c "curl -s http://project-backend-service.devops.svc.cluster.local/api/data"
kubectl run --rm -it curl-test --image=curlimages/curl --restart=Never -n devops -- /bin/sh -c "curl -s http://project-backend-v2-service.devops.svc.cluster.local/api/data"
```

Internal DNS options (choose one)
- Recommended (simple): Use namespace + service names. Example: project-backend.devops resolves inside cluster. Create alias Service (be1) that uses same selector to expose the same endpoints; then be1.devops works.
  - Create alias service file: be1-service-devops.yaml (already in repo).
- Alternative (global rewrite): Patch CoreDNS to rewrite *.va -> *.devops.svc.cluster.local (advanced, cluster‑wide change). Steps:
  - Backup CoreDNS ConfigMap
  - Apply coredns-rewrite-patch.yaml
  - Restart CoreDNS: kubectl rollout restart deployment/coredns -n kube-system
  - Test nslookup/curl inside cluster
  - Rollback by restoring backup if needed

Ingress notes
- Ingress must be in same namespace as services, or use fully qualified backendService references (namespace field in v1 Ingress is the Ingress namespace; backend service name is resolved in that namespace).
- Use `ingressClassName: nginx` and ensure ingress controller is Ready.
- If you see 503: check `kubectl get endpoints -n devops` — services with no endpoints cause 503.
- To update ingress rules:
```powershell
kubectl apply -f ./ingress-devops.yaml
# or edit
kubectl edit ingress project-unified-ingress -n devops
```
- To remove ingress:
```powershell
kubectl delete -f ./ingress-devops.yaml
```

6) Add Resource limits and probes  
- Edit the deployment manifests to include `resources.requests`/`limits` and `livenessProbe` / `readinessProbe` for each container. Example (add to container spec):
```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /api/data
    port: 3000
  initialDelaySeconds: 2
  periodSeconds: 5
```
Apply updated manifests:
```powershell
kubectl apply -f ./backend-deployment.yaml
kubectl apply -f ./frontend-deployment.yaml
```

7) Enable HPA (metrics-server)
```powershell
# install metrics-server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# patch for kind TLS if necessary
kubectl patch -n kube-system deployment metrics-server --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl rollout status deployment/metrics-server -n kube-system

# apply HPA
kubectl apply -f ./backend-hpa.yaml
kubectl get hpa
```

8) Create load to trigger HPA (run in other terminal)
```powershell
kubectl run -it --rm load-generator --image=curlimages/curl --restart=Never -- /bin/sh -c "while true; do curl -s http://project-backend-service/api/data >/dev/null; sleep 0.1; done"
# monitor:
kubectl get hpa -w
kubectl get pods -l app=project-backend --watch
```

9) Deploy new backend/frontend versions and routing options
Option A — Rolling update (replace image on same Deployment):
```powershell
# ensure my-frontend:v2 is loaded into kind
kind load docker-image my-frontend:v2 --name k8s-learning
kubectl set image deployment/project-frontend frontend=my-frontend:v2
kubectl rollout status deployment/project-frontend
```

Option B — Multi‑app parallel (keep v1 + v2 running)
- Create new Deployment/Service for v2 (e.g. `project-frontend-v2`, `project-frontend-v2-service`) and add Ingress path `/v2` to route to it. Apply those manifests, then:
```powershell
kubectl apply -f ./frontend-v2-deployment.yaml
kubectl apply -f ./frontend-v2-service.yaml
kubectl apply -f ./ingress.yaml  # updated with /v2 path
curl http://localhost/      # v1
curl http://localhost/v2    # v2
```

10) Rollback
```powershell
# rollback a deployment to previous revision
kubectl rollout undo deployment/project-frontend
kubectl rollout status deployment/project-frontend
```

Service‑to‑service test (from inside cluster)
```powershell
kubectl run --rm -it curl-test --image=curlimages/curl --restart=Never -- /bin/sh -c "curl -v http://project-backend-service/api/data && echo"
# or exec from frontend pod
kubectl exec -it <frontend-pod-name> -- wget -qO- http://project-backend-service/api/data
```

Debug checklist
- Are pods Ready? kubectl get pods -o wide  
- Are services exposing endpoints? kubectl get endpoints <svc>  
- Ingress controller running? kubectl get pods -n ingress-nginx  
- Ingress routes correct? kubectl describe ingress <name>  
- Metrics API available? kubectl top pods (requires metrics-server)  
- Logs: kubectl logs <pod> or kubectl logs -l app=<app>

Cleanup
```powershell
kubectl delete -f ./backend-hpa.yaml
kubectl delete -f ./ingress.yaml
kubectl delete -f ./frontend-deployment.yaml
kubectl delete -f ./frontend-service.yaml
kubectl delete -f ./backend-deployment.yaml
kubectl delete -f ./backend-service.yaml

# remove devops app resources
kubectl delete -f ./k8s-resources/backend-v1-deployment-devops.yaml
kubectl delete -f ./k8s-resources/backend-v2-deployment-devops.yaml
kubectl delete -f ./k8s-resources/frontend-deployment-devops.yaml
kubectl delete -f ./k8s-resources/be1-service-devops.yaml
kubectl delete -f ./k8s-resources/be2-service-devops.yaml
kubectl delete -f ./k8s-resources/ingress.yaml -n devops

# rollback CoreDNS if patched
kubectl apply -f ./k8s-resources/coredns.backup.yaml   # if you saved backup locally
kubectl rollout restart deployment/coredns -n kube-system

# delete ingress controller
kubectl delete -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

# delete namespace
kubectl delete namespace devops

# delete kind cluster
kind delete cluster --name k8s-learning
```

Checklist: what to verify in your repo
- Confirm these files exist and contain namespace: devops where required:
  - namespace-devops.yaml
  - backend-v1-deployment-devops.yaml
  - backend-v2-deployment-devops.yaml
  - frontend-deployment-devops.yaml
  - ingress.yaml (namespace: devops)
  - be1-service-devops.yaml, be2-service-devops.yaml (optional aliases)
  - backend-hpa.yaml
  - kind-config.yaml
  - Dockerfiles for backend, backend-v2, frontend
- If FE v2 desired: add frontend-v2 deployment + service files.

Notes
- Use relative paths in commands; do not hardcode local absolute paths.  
- For Kind, `imagePullPolicy: Never` is recommended for loaded local images.  
- For production or CI, push images to a registry and update manifests accordingly.
- Browser clients must call ingress (use relative '/api' in FE). Pod internal calls use service DNS (be1.devops, project-backend.devops, or FQDN).
- Always load local images into kind before applying deployments or use a registry and change imagePullPolicy.