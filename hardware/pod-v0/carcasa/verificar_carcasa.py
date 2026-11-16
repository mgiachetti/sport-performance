#!/usr/bin/env python3
"""Verifica la carcasa contra los componentes y dibuja cortes y vistas.

Uso:
    python3 generar_carcasa.py --volcar /tmp/campos.npz          (o con --fdm)
    python3 verificar_carcasa.py /tmp/campos.npz carpeta_de_salida   (con POD_FDM=1 para la variante de filamento)

Revisa que las tapas no se pisen, que nada choque con los componentes (la tabla comp de abajo
sigue la ubicacion de la placa de KiCad del 15/11/2026, con las pasivas movidas al rutear (16/11/2026),
hardware/tools/datos/ubicacion_pod_v0.csv: cajas
que envuelven cada parte o grupo, con su alto), el espesor minimo de pared y el desvio de la malla.
Necesita numpy, scipy, scikit-image y matplotlib.
"""
import os, sys, numpy as np
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import generar_carcasa as g
from scipy.ndimage import map_coordinates, distance_transform_edt, affine_transform
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
d=np.load(sys.argv[1]); inf,sup,xs,ys,zs=d['inf'],d['sup'],d['xs'],d['ys'],d['zs']
P=g.PASO; out=sys.argv[2]
print('solape entre tapas (voxeles):', int(((inf<-0.02)&(sup<-0.02)).sum()))
comp={
 'patch (max)':(12.5,37.5,4.5,29.5,1.6,10.12),'LC29H':(0.8,16.8,33.65,45.85,1.6,4.3),
 'cadena RF':(17.1,28.4,32.1,49.9,1.6,2.6),'U.FL Taoglas enchufado':(17.4,21.0,33.4,37.4,1.6,4.1),
 'BMD-340':(0,15,50,60.2,1.6,3.5),'IMU':(27.25,29.75,35.0,38.0,1.6,2.5),
 'BMP581':(44,46,19,21,1.6,2.4),'NAND':(19,27,52.5,58.5,1.6,2.4),'buck (U103, L101 al este, C105, C106)':(18.25,24.0,58.88,65.12,1.6,2.6),
 'BQ25180':(14.2,15.8,64.4,65.6,1.6,2.2),'C102 y C103 (cargador)':(14.12,17.17,62.22,65.96,1.6,2.5),
 'C301 y C302 (VREG del BMD-340)':(15.34,18.28,53.97,57.03,1.6,2.5),'C309 (VREG_LORA)':(26.34,28.25,51.25,52.25,1.6,2.2),'Ra-01SH':(31,49.4,37,54,1.6,4.8),'U.FL de prueba LoRa enchufado':(44.8,48.8,60.75,63.95,1.6,4.1),
 'antena LoRa':(35.5,41.7,67.6,69.7,1.6,2.68),'J201 (QGNSS)':(0.7,7.3,24.3,32.1,1.6,4.5),
 'buzzer (sin montar)':(40.8,49.3,23.15,31.65,1.6,4.6),
 'LED':(7.7,9.3,1.45,2.95,1.6,2.2),'celda (max)':(12,42,14,62,-6.2,-1.0),'Hall':(44.35,47.65,40.5,43.5,-1.1,0),
 'J101':(8.9,16.3,63.8,68.2,-2.1,0),'ficha de J101 enchufada (estimada)':(9.3,15.9,60.0,63.8,-2.1,0),
 'C405 (junto a la camara del barometro)':(41.1,42.1,19.1,20.1,1.6,2.15),
 'DPS368 (sin montar)':(46.96,49.04,18.71,21.29,1.6,2.33),'LED302 (sin montar)':(7.7,9.3,4.05,5.55,1.6,2.2),
 'driver del buzzer (Q304, D301, R319)':(40.15,47.85,32.5,36.7,1.6,2.7),'resortes inserto':(17,33,6,8,-2.5,0),
 'ESD de USB (abajo, TPD2E2U06 DRL)':(18.95,20.55,11.5,13.1,-0.6,0),'TVS, eFuse y divisores (abajo)':(33.6,40.7,3.8,14.8,-1.1,0),
 'traductores, LDO y bias-T (abajo)':(0.4,11.9,11.0,47.3,-1.45,0),
 'botón SW301 (abajo)':(43.35,49.45,26.2,34.8,-2.6,0),'reset SW101 (abajo, sin montar)':(43.25,49.35,54.2,62.8,-2.6,0),
 'C308 y Q101 (abajo, sin montar)':(43.2,49.15,46.15,54.2,-1.8,0),'C306 y C307 (abajo)':(46.7,49.7,47.0,50.0,-1.0,0),
 'grilla de 0402 (abajo, paradas)':(17.39,26.42,49.22,55.38,-0.4,0),'R501 (abajo)':(9.42,11.38,46.94,47.97,-0.4,0),
 'cabeza tornillo 1':(4.1,7.9,6.1,9.9,1.6,3.2),'cabeza tornillo 2':(42.1,45.9,6.1,9.9,1.6,3.2),'cabeza tornillo 3':(22.1,25.9,64.1,67.9,1.6,3.2)}
X,Y,Z=np.meshgrid(xs,ys,zs,indexing='ij',sparse=True)
caso=np.minimum(inf,sup); mal=0
print('rosca util en la tapa superior: %.1f mm; piel sobre el piloto abajo: %.1f mm'%(g.Z_ASIENTO+12-g.Z_TETON_SUP, g.Z_TECHO_BAJO+g.TECHO-g.Z_PILOTO))
pcb=(g.rrect(0,50,0,70,5.0)<-0.06)&(Z>0.06)&(Z<1.54)
for cx,cy in g.CIERRE: pcb=pcb&(np.hypot(X-cx,Y-cy)>2.7)
for cx,cy in g.CIERRE:
    m=(np.hypot(X-cx,Y-cy)<0.95)&(Z>g.Z_ASIENTO+0.05)&(Z<g.Z_TETON_INF)|(np.hypot(X-cx,Y-cy)<1.7)&(Z>g.Z_ASIENTO-1.3)&(Z<g.Z_ASIENTO-0.05)
    c=int((m&(caso<-0.05)).sum()); mal+=c; print('tornillo de cierre',(cx,cy),'ok' if c==0 else f'CHOQUE {c}')
c=int((pcb&(caso<-0.05)).sum()); print('PCB con radio 5:', 'ok' if c==0 else f'CHOQUE {c}'); mal+=c
for n,(x0,x1,y0,y1,z0,z1) in comp.items():
    e=0.06; m=(X>x0+e)&(X<x1-e)&(Y>y0+e)&(Y<y1-e)&(Z>z0+e)&(Z<z1-e); c=int((m&(caso<-0.05)).sum()); mal+=c
    if c:
        idx=np.argwhere(m&(caso<-0.05)); lo=idx.min(0); hi=idx.max(0)
        print(f'CHOQUE {n}: {c} vox, x {xs[lo[0]]:.1f}-{xs[hi[0]]:.1f} y {ys[lo[1]]:.1f}-{ys[hi[1]]:.1f} z {zs[lo[2]]:.1f}-{zs[hi[2]]:.1f}')
print('componentes sin choque' if mal==0 else 'HAY CHOQUES')
# espesor minimo de pared de la cascara sin agujeros
ext,cav,_=g.envolvente()
edt=distance_transform_edt(ext<0)*P; borde=(cav<0)&(cav>-P)
i=np.argmin(np.where(borde,edt,99)); ii=np.unravel_index(i,edt.shape)
print('espesor minimo de la cascara: %.2f mm en x=%.1f y=%.1f z=%.1f'%(edt[ii],xs[ii[0]],ys[ii[1]],zs[ii[2]]))
from scipy.ndimage import label
guia=d['guia']; print('guia de luz: piezas sueltas =',label(guia<0)[1],'| choque con las tapas (vox):',int(((guia<-0.02)&(caso<-0.02)).sum()),'| choque con el LED (vox):',int(((guia<0)&(X>7.7)&(X<9.3)&(Y>1.45)&(Y<2.95)&(Z>1.6)&(Z<2.2)).sum()),'| luz sobre el LED: %.2f mm'%(zs[np.argmax((guia<0)[np.argmin(abs(xs-8.5)),np.argmin(abs(ys-2.2))])]-2.2))
print('alto exterior: nuca %.1f mm, extremo de abajo %.1f mm'%(g.Z_TECHO+g.TECHO-g.ZB, g.Z_TECHO_BAJO+g.TECHO-g.ZB))
for nom,sdf in (('inf',inf),('sup',sup)):
    v,f=g.malla(sdf); v2,f2=g.simplificar(v,f)
    c=v2[f2].mean(1); q=((c-np.array([xs[0],ys[0],zs[0]]))/P).T
    dev=np.abs(map_coordinates(sdf,q,order=1)); print(nom,'desvio max %.3f mm'%dev.max(),'cerrada',g.cerrada(f2),'vol %.1f cm3'%(g.volumen(v2,f2)/1000))
# cortes
fig,ax=plt.subplots(3,1,figsize=(11,9))
def corte(a,eje,val,titulo):
    if eje=='x':
        i=np.argmin(abs(xs-val)); a.contourf(ys,zs,inf[i].T,levels=[-99,0],colors=['#5F5E5A']); a.contourf(ys,zs,sup[i].T,levels=[-99,0],colors=['#378ADD'])
        a.add_patch(Rectangle((0,0),70,1.6,fc='none',ec='#D85A30',lw=1))
        for n,(x0,x1,y0,y1,z0,z1) in comp.items():
            if x0<=val<=x1: a.add_patch(Rectangle((y0,z0),y1-y0,z1-z0,fc='none',ec='#D85A30',lw=1)); a.text(y0+.3,z1+.2,n,fontsize=6,color='#993C1D')
        a.set_xlabel('y (mm), nuca a la izquierda')
    else:
        j=np.argmin(abs(ys-val)); a.contourf(xs,zs,inf[:,j].T,levels=[-99,0],colors=['#5F5E5A']); a.contourf(xs,zs,sup[:,j].T,levels=[-99,0],colors=['#378ADD'])
        a.add_patch(Rectangle((0,0),50,1.6,fc='none',ec='#D85A30',lw=1))
        for n,(x0,x1,y0,y1,z0,z1) in comp.items():
            if y0<=val<=y1: a.add_patch(Rectangle((x0,z0),x1-x0,z1-z0,fc='none',ec='#D85A30',lw=1)); a.text(x0+.3,z1+.2,n,fontsize=6,color='#993C1D')
        a.set_xlabel('x (mm)')
    a.set_aspect('equal'); a.set_title(titulo,fontsize=10); a.set_ylabel('z (mm)')
corte(ax[0],'x',25,'Corte a lo largo por x = 25: cuña, patch, inserto de contactos, celda y tornillo de abajo')
corte(ax[1],'y',67.4,'Corte por y = 67,4: los dos tornillos de cierre de abajo, con su teton en cada tapa')
corte(ax[2],'y',20,'Corte por y = 20: cámara y ventilación del barómetro, y encastre a presión')
plt.tight_layout(); plt.savefig(out+'/cortes.png',dpi=130); plt.close()
# vistas en perspectiva: marco de vista (derecha, arriba, hacia el observador), sin espejar
def rot(ax_,deg):
    a=np.radians(deg); c,s=np.cos(a),np.sin(a)
    return {'x':np.array([[1,0,0],[0,c,-s],[0,s,c]]),'y':np.array([[c,0,s],[0,1,0],[-s,0,c]]),'z':np.array([[c,-s,0],[s,c,0],[0,0,1]])}[ax_]
def vista(R,a):
    assert abs(np.linalg.det(R)-1)<1e-6
    n=np.array(inf.shape); cm=(n-1)/2; N=int(np.linalg.norm(n))+4; shp=(N,N,N); cv=(np.array(shp)-1)/2
    Rt=R.T; off=cm-Rt@cv; capas=[]
    for sdf in (inf,sup):
        r=affine_transform(sdf,Rt,offset=off,output_shape=shp,order=1,cval=3.0)
        m=r<0; hay=m.any(2); kk=N-1-np.argmax(m[:,:,::-1],axis=2)
        k1=np.clip(kk+1,0,N-1); v0=np.take_along_axis(r,kk[...,None],2)[...,0]; v1=np.take_along_axis(r,k1[...,None],2)[...,0]
        capas.append(np.where(hay,kk+np.clip(v0/(v0-v1+1e-9),0,1),-1e3))
    h=np.maximum(*capas); quien=np.argmax(np.stack(capas),0); hay=h>-1e2
    hh=np.where(hay,h,h[hay].min()-8)
    ga,gb=np.gradient(hh); nn=np.dstack([-ga,-gb,np.ones_like(hh)]); nn/=np.linalg.norm(nn,axis=2,keepdims=True)
    l=np.array([-0.45,0.6,0.66]); l/=np.linalg.norm(l); dif=np.clip((nn*l).sum(2),0,1)
    hv=(l+np.array([0,0,1])); hv/=np.linalg.norm(hv); esp=np.clip((nn*hv).sum(2),0,1)**50
    col=np.where(quien[...,None]==1,np.array([0.17,0.19,0.22]),np.array([0.93,0.43,0.16]))
    img=col*(0.38+0.72*dif[...,None])+0.30*esp[...,None]
    img=np.where(hay[...,None],np.clip(img,0,1),1.0)
    img=np.transpose(img,(1,0,2))[::-1]; hy=hay.T[::-1]; r_,c_=np.where(hy)
    a.imshow(img[r_.min()-6:r_.max()+7, c_.min()-6:c_.max()+7],interpolation='bicubic'); a.axis('off')
fig,ax=plt.subplots(1,3,figsize=(15,6.2),gridspec_kw={'width_ratios':[1,1.15,1]})
vista(rot('x',30)@rot('y',24)@rot('z',180),ax[0]); ax[0].set_title('Lado del tackle: ranura del LED en la nuca',fontsize=12)
vista(rot('x',14)@np.array([[0,1.,0],[0,0,1.],[1.,0,0]]),ax[1]); ax[1].set_title('Perfil derecho: nuca a la izquierda',fontsize=12)
vista(rot('x',-30)@rot('y',-24)@rot('x',180),ax[2]); ax[2].set_title('Cara del cuerpo, con los cinco contactos',fontsize=12)
plt.tight_layout(); plt.savefig(out+'/vistas.png',dpi=120); plt.close()
